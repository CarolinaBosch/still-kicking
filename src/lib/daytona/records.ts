// Patient records persisted in Daytona. SERVER ONLY.
//
// Storage choice: we first tried a Daytona Volume ("still-kicking-records").
// On this account `volume.get(name, create)` returns "Access denied", so records
// live in ONE long-lived records sandbox instead:
//   - found by labels app=still-kicking, role=records; created if missing
//   - not ephemeral, no auto-delete; auto-stops after 60 idle minutes and is
//     started again on the next access (its filesystem survives a stop)
//   - layout: /home/daytona/records/index.json      {"patient_ids": [...]}
//             /home/daytona/records/patients/<id>.json   PatientState
// The store keeps an in-process cache and writes through to this sandbox in the
// background (coalesced per patient), so reads and emergency alerts never wait
// on Daytona. If a Volume becomes available, only this file changes: mount it
// into the records sandbox at RECORDS_DIR.

import type { Sandbox } from "@daytona/sdk";
import type { PatientState } from "../types";
import { APP_LABEL, REMOTE_HOME, StoreError, errText, getDaytona, processGlobal, withTimeout } from "./client";

const RECORDS_DIR = `${REMOTE_HOME}/records`;
const INDEX_PATH = `${RECORDS_DIR}/index.json`;
const patientPath = (id: string) => `${RECORDS_DIR}/patients/${id}.json`;
const LABELS = { app: APP_LABEL, role: "records" };

const CREATE_TIMEOUT_S = 60;
const START_TIMEOUT_S = 60;
const IO_TIMEOUT_S = 15;
const AUTO_STOP_MIN = 60;
const LOOKUP_BUDGET_MS = 90_000;

const vault = processGlobal("records", () => ({
  sandbox: null as Promise<Sandbox> | null,
  pending: new Map<string, string>(), // patient id -> latest JSON snapshot
  pendingIndex: null as string | null,
  flushing: null as Promise<void> | null,
}));

async function findOrCreate(): Promise<Sandbox> {
  const daytona = getDaytona();
  let found: Sandbox | null = null;
  for await (const sb of daytona.list({ labels: LABELS })) {
    found = sb;
    break;
  }
  if (!found) {
    found = await daytona.create(
      { language: "python", labels: LABELS, autoStopInterval: AUTO_STOP_MIN, autoDeleteInterval: -1 },
      { timeout: CREATE_TIMEOUT_S },
    );
    console.info("[records] created records sandbox", found.id);
  }
  if (found.state !== "started") await found.start(START_TIMEOUT_S);
  return found;
}

/** The records sandbox, found or created once per process. A failed lookup is retried next call. */
export function recordsSandbox(): Promise<Sandbox> {
  if (!vault.sandbox) {
    const lookup = withTimeout(findOrCreate(), LOOKUP_BUDGET_MS, "The care records are not reachable right now.");
    lookup.catch(() => {
      if (vault.sandbox === lookup) vault.sandbox = null;
    });
    vault.sandbox = lookup;
  }
  return vault.sandbox;
}

/** All persisted patient states, or null when the records sandbox holds no records yet. */
export async function loadRecords(): Promise<PatientState[] | null> {
  const sandbox = await recordsSandbox();
  const [index] = await sandbox.fs.downloadFiles([{ source: INDEX_PATH }], IO_TIMEOUT_S);
  if (index.error || !index.result) return null;
  const ids = (JSON.parse(index.result.toString()) as { patient_ids?: unknown }).patient_ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;

  const files = await sandbox.fs.downloadFiles(
    ids.map((id) => ({ source: patientPath(String(id)) })),
    IO_TIMEOUT_S,
  );
  const states: PatientState[] = [];
  for (const file of files) {
    if (file.error || !file.result) return null; // partial records: caller reseeds
    states.push(JSON.parse(file.result.toString()) as PatientState);
  }
  return states;
}

// ---------- background write-through ----------

async function upload(files: { path: string; body: string }[]): Promise<void> {
  const sandbox = await recordsSandbox();
  await sandbox.fs.uploadFiles(
    files.map((f) => ({ source: Buffer.from(f.body), destination: f.path })),
    IO_TIMEOUT_S,
  );
}

async function flushLoop(): Promise<void> {
  while (vault.pending.size > 0 || vault.pendingIndex !== null) {
    const batch = [...vault.pending].map(([id, body]) => ({ path: patientPath(id), body }));
    if (vault.pendingIndex !== null) batch.push({ path: INDEX_PATH, body: vault.pendingIndex });
    vault.pending.clear();
    vault.pendingIndex = null;
    try {
      await upload(batch);
    } catch (err) {
      // One retry after re-resolving the sandbox (it may have auto-stopped).
      console.error("[records] write failed, retrying", errText(err));
      vault.sandbox = null;
      try {
        await upload(batch);
      } catch (retryErr) {
        console.error("[records] write lost; cache still holds it", errText(retryErr));
      }
    }
  }
}

/** Queue a snapshot of these patients (and optionally the index) for upload. Returns immediately. */
export function saveInBackground(states: PatientState[], writeIndex = false): void {
  for (const s of states) vault.pending.set(s.patient.id, JSON.stringify(s));
  if (writeIndex) vault.pendingIndex = JSON.stringify({ patient_ids: states.map((s) => s.patient.id) });
  if (!vault.flushing) {
    vault.flushing = flushLoop().finally(() => {
      vault.flushing = null;
    });
  }
}

/** Wait until queued writes have reached the records sandbox. */
export async function flushRecords(): Promise<void> {
  while (vault.flushing) await vault.flushing;
}

export async function recordsSandboxId(): Promise<string> {
  try {
    return (await recordsSandbox()).id;
  } catch (err) {
    throw new StoreError("The care records are not reachable right now.", 503, { cause: err });
  }
}
