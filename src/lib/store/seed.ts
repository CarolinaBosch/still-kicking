// Synthetic demo patients from data/seed/patients.json. SERVER ONLY.
// Seed timestamps are written against a fixed "anchor" day; at load they are
// shifted so the anchor becomes today and the last seeded call was yesterday.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Alert, CallAttempt, CheckinRecord, Patient, PatientState } from "../types";
import { computeStatus } from "./status";

const SEED_PATH = path.join(process.cwd(), "data", "seed", "patients.json");
const DAY_MS = 86_400_000;

interface SeedFile {
  anchor: string;
  // `alerts` is optional: open alerts produced by running the engine on a seeded call.
  patients: { patient: Patient; history: CheckinRecord[]; attempts: CallAttempt[]; alerts?: Alert[] }[];
}

export async function loadSeed(now = new Date()): Promise<PatientState[]> {
  const seed = JSON.parse(await readFile(SEED_PATH, "utf8")) as SeedFile;
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const offset = today - Date.parse(seed.anchor);
  const shift = (iso: string) => new Date(Date.parse(iso) + offset).toISOString();

  return seed.patients.map(({ patient, history, attempts, alerts = [] }) => {
    const state: PatientState = {
      patient,
      status: "green",
      history: history.map((r) => ({ ...r, timestamp: shift(r.timestamp) })),
      attempts: attempts.map((a) => ({ ...a, at: shift(a.at) })),
      alerts: alerts.map((a) => ({
        ...a,
        created_at: shift(a.created_at),
        sms_log: a.sms_log.map((m) => ({ ...m, at: shift(m.at) })),
      })),
      last_analysis: null,
    };
    state.status = computeStatus(state);
    return state;
  });
}
