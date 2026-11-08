// Records store + engine facade. SERVER ONLY. Owner: hack-sandbox.
// API routes import ONLY these functions (and StoreError for HTTP status + speakable message).
//
// Where things live:
//   - Patient records: a long-lived Daytona records sandbox (see ../daytona/records.ts for
//     why not a Volume). This module keeps an in-process cache and writes through to it in
//     the background, so reads and emergencies never wait on the network.
//   - Analysis: every finished call runs engine/engine.py in a fresh Daytona sandbox
//     (../daytona/engine.ts); its output is validated before it touches a record.
//   - Tests: engine/tests run in another fresh sandbox on demand.

import { randomUUID } from "node:crypto";
import type {
  Alert,
  AnalysisResult,
  CheckinRecord,
  EmergencyInput,
  MissedCallResult,
  Patient,
  PatientState,
  Severity,
  StopAndWatch,
  TestRunResult,
} from "../types";
import { consecutiveMissed, shouldEscalate } from "../daytona/attempts";
import { StoreError, errText, processGlobal, withTimeout } from "../daytona/client";
import { runEngine, runTests } from "../daytona/engine";
import type { AlertDraft } from "../daytona/engine-output";
import { flushRecords, loadRecords, saveInBackground } from "../daytona/records";
import { loadSeed } from "./seed";
import { computeStatus } from "./status";

export { StoreError } from "../daytona/client";

const HISTORY_FOR_ENGINE = 30; // calls sent to the engine with each new record
const DUPLICATE_ALERT_WINDOW_MS = 60 * 60_000;
const RESET_FLUSH_WAIT_MS = 15_000;

const cache = processGlobal("store", () => ({
  states: new Map<string, PatientState>(),
  ready: null as Promise<void> | null,
}));

// ---------- cache ----------

function fill(states: PatientState[]): void {
  cache.states.clear();
  for (const s of states) cache.states.set(s.patient.id, s);
}

async function hydrate(): Promise<void> {
  try {
    const stored = await loadRecords();
    if (stored) {
      fill(stored);
      console.info(`[store] loaded ${stored.length} patients from the Daytona records sandbox`);
      return;
    }
  } catch (err) {
    console.error("[store] records sandbox unavailable, starting from seed", errText(err));
  }
  const seeded = await loadSeed();
  fill(seeded);
  saveInBackground(seeded, true);
}

async function states(): Promise<Map<string, PatientState>> {
  if (!cache.ready) {
    const hydrating = hydrate();
    hydrating.catch(() => {
      if (cache.ready === hydrating) cache.ready = null;
    });
    cache.ready = hydrating;
  }
  try {
    await cache.ready;
  } catch (err) {
    throw new StoreError("Patient records are not available right now.", 503, { cause: err });
  }
  return cache.states;
}

async function patientState(patientId: string): Promise<PatientState> {
  const state = (await states()).get(patientId);
  if (!state) throw new StoreError("I don't know that patient.", 404);
  return state;
}

function commit(state: PatientState): void {
  state.status = computeStatus(state);
  saveInBackground([state]);
}

const snapshot = <T>(value: T): T => structuredClone(value);

// ---------- alerts ----------

const RED_FLAG_LABELS: Record<string, string> = {
  chest_pain: "Chest pain",
  breathing: "Trouble breathing",
  fall: "Fall",
  stroke_signs: "Possible stroke signs",
  fainting: "Fainting",
  bleeding: "Bleeding",
  safety: "Safety concern",
  confusion: "Sudden confusion",
};

/** Same title the engine gives a red flag (engine/rules.py red_flag_title), so duplicates can be matched. */
function redFlagTitle(redFlag: string): string {
  const type = redFlag.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const label = RED_FLAG_LABELS[type] ?? (redFlag.trim().slice(0, 60) || "Red flag");
  return `${label} reported during call`;
}

type AlertContent = Pick<Alert, "severity" | "kind" | "title" | "detail" | "quote">;

function smsText(patient: Patient, content: AlertContent, to: "nurse" | "caregiver"): string {
  const quote = content.quote ? ` They said: "${content.quote.slice(0, 120)}".` : "";
  const ask: Record<Severity, string> = {
    emergency: to === "nurse" ? "Call them now." : "They were told to call 911. The nurse has been alerted.",
    urgent: to === "nurse" ? "Please follow up today." : "The nurse has been alerted and will follow up today.",
    watch: to === "nurse" ? "Please review." : "The nurse will review.",
  };
  return `Still Kicking ${content.severity.toUpperCase()}: ${content.title} (${patient.preferred_name}).${quote} ${ask[content.severity]}`;
}

function newAlert(patient: Patient, content: AlertContent): Alert {
  const at = new Date().toISOString();
  return {
    id: randomUUID(),
    patient_id: patient.id,
    ...content,
    created_at: at,
    status: "open",
    acknowledged_by: null,
    notes: [],
    // Simulated: no real SMS is sent in this build.
    sms_log: [
      { to: "nurse", name: patient.nurse.name, at, text: smsText(patient, content, "nurse") },
      { to: "caregiver", name: patient.caregiver.name, at, text: smsText(patient, content, "caregiver") },
    ],
  };
}

function recentOpenAlert(state: PatientState, title: string): Alert | undefined {
  const cutoff = Date.now() - DUPLICATE_ALERT_WINDOW_MS;
  return state.alerts.find((a) => a.status === "open" && a.title === title && Date.parse(a.created_at) >= cutoff);
}

// ---------- incoming records ----------

const SW_KEYS: (keyof StopAndWatch)[] = [
  "seems_different", "talks_less", "needs_more_help", "ate_less", "bowel_change", "drank_less",
  "weight_or_swelling", "agitated", "tired_weak_confused", "skin_change", "walking_toileting_help",
];
const SEVERITIES: readonly Severity[] = ["emergency", "urgent", "watch"];

const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const clamp = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
const text = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const field = (v: unknown, key: string): unknown => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined);

/** The record comes from the voice agent (a model): fill gaps and clamp values instead of trusting its shape. */
function normalizeRecord(raw: unknown): CheckinRecord {
  const r = (k: string) => field(raw, k);
  const sw = r("stop_and_watch");
  const meds = r("medication_adherence");
  const pain = r("pain");
  const cs: CheckinRecord["condition_specific"] = {};
  const rawCs = r("condition_specific");
  for (const [k, v] of Object.entries(rawCs && typeof rawCs === "object" ? rawCs : {}).slice(0, 30)) {
    if (v === null || typeof v === "number" || typeof v === "boolean") cs[k.slice(0, 60)] = v;
    else if (typeof v === "string") cs[k.slice(0, 60)] = v.slice(0, 200);
  }
  const ts = text(r("timestamp"), 40);
  return {
    call_id: text(r("call_id"), 80) || randomUUID(),
    patient_id: text(r("patient_id"), 40),
    timestamp: ts && !Number.isNaN(Date.parse(ts)) ? new Date(ts).toISOString() : new Date().toISOString(),
    red_flags: list(r("red_flags"), 10).map((f) => {
      const severity = field(f, "severity");
      return {
        type: text(field(f, "type"), 40) || "other",
        quote: text(field(f, "quote"), 300),
        severity: SEVERITIES.includes(severity as Severity) ? (severity as Severity) : "urgent",
      };
    }),
    stop_and_watch: Object.fromEntries(SW_KEYS.map((k) => [k, bool(field(sw, k))])) as unknown as StopAndWatch,
    pain: {
      present: bool(field(pain, "present")),
      location: text(field(pain, "location"), 100),
      score: clamp(field(pain, "score"), 0, 10),
      new_or_worse: bool(field(pain, "new_or_worse")),
    },
    orientation_correct: bool(r("orientation_correct")),
    medication_adherence: {
      all_taken: bool(field(meds, "all_taken")),
      missed: list(field(meds, "missed"), 10).map((m) => ({
        med: text(field(m, "med"), 80),
        doses_missed: clamp(field(m, "doses_missed"), 0, 10) ?? 1,
        reason: text(field(m, "reason"), 200),
      })),
      prn_use_increased: bool(field(meds, "prn_use_increased")),
      running_low: list(field(meds, "running_low"), 10).map((m) => text(m, 80)),
    },
    phq2_score: clamp(r("phq2_score"), 0, 6),
    condition_specific: cs,
    weight_lb: clamp(r("weight_lb"), 50, 600),
    patient_message_for_caregiver: text(r("patient_message_for_caregiver")),
    patient_quote: text(r("patient_quote"), 300),
    extraction_confidence: clamp(r("extraction_confidence"), 0, 1) ?? 0.5,
  };
}

// ---------- public API ----------

/** All patients with history (oldest first), attempts, alerts (newest first). Seeds on first use. */
export async function listPatients(): Promise<PatientState[]> {
  const all = await states();
  return snapshot([...all.values()].sort((a, b) => a.patient.id.localeCompare(b.patient.id)));
}

export async function getPatientState(patientId: string): Promise<PatientState | null> {
  const state = (await states()).get(patientId);
  return state ? snapshot(state) : null;
}

/** Persists the record, runs the Daytona engine on it + history, persists the analysis and any new alerts. */
export async function analyzeCheckin(record: CheckinRecord): Promise<AnalysisResult> {
  const rec = normalizeRecord(record);
  const state = await patientState(rec.patient_id);

  // A retried submit_checkin for the same call gets the analysis we already have.
  if (state.history.some((h) => h.call_id === rec.call_id)) {
    if (state.last_analysis?.call_id === rec.call_id) return snapshot(state.last_analysis);
    throw new StoreError("That check-in was already received.", 409);
  }

  const prior = state.history.slice(-HISTORY_FOR_ENGINE);
  state.history.push(rec);
  state.attempts.push({ patient_id: rec.patient_id, at: rec.timestamp, answered: true });
  commit(state);

  let run;
  try {
    run = await runEngine({ patient: state.patient, history: prior, record: rec });
  } catch (err) {
    throw new StoreError("I saved the check-in, but the analysis didn't finish. The nurse will review it.", 502, { cause: err });
  }

  // A red flag already raised live by raiseEmergency is not alerted twice.
  const newAlerts = run.output.alerts
    .filter((d: AlertDraft) => !(d.kind === "red_flag" && recentOpenAlert(state, d.title)))
    .map((d) => newAlert(state.patient, d));

  const result: AnalysisResult = {
    patient_id: rec.patient_id,
    call_id: rec.call_id,
    findings: run.output.findings,
    trend_flags: run.output.trend_flags,
    summary: run.output.summary,
    new_alerts: newAlerts,
    sandbox_id: run.sandbox_id,
    sandbox_ms: run.sandbox_ms,
  };
  state.alerts.unshift(...newAlerts);
  state.last_analysis = result;
  commit(state);
  return snapshot(result);
}

/** Called DURING the voice call. Creates an emergency alert + simulated SMS to nurse and caregiver. Must be fast (<2 s). */
export async function raiseEmergency(input: EmergencyInput): Promise<Alert> {
  const state = await patientState(text(field(input, "patient_id"), 40));
  const title = redFlagTitle(text(field(input, "red_flag"), 60));
  const existing = recentOpenAlert(state, title);
  if (existing) return snapshot(existing);

  const alert = newAlert(state.patient, {
    severity: "emergency",
    kind: "red_flag",
    title,
    detail: "Raised live during the check-in call. The patient was told to call 911.",
    quote: text(field(input, "quote"), 300) || null,
  });
  state.alerts.unshift(alert);
  commit(state); // cache now; the records sandbox write happens in the background
  return snapshot(alert);
}

/** Records one unanswered attempt. On the 3rd consecutive miss, creates an urgent missed_calls alert. */
export async function recordMissedCall(patientId: string): Promise<MissedCallResult> {
  const state = await patientState(patientId);
  state.attempts.push({ patient_id: patientId, at: new Date().toISOString(), answered: false });

  const count = consecutiveMissed(state.attempts);
  const openMissed = state.alerts.some((a) => a.kind === "missed_calls" && a.status !== "resolved");
  let alert: Alert | null = null;
  if (shouldEscalate(state.attempts, openMissed)) {
    // Same wording as engine/attempts.py missed_call_alert.
    alert = newAlert(state.patient, {
      severity: "urgent",
      kind: "missed_calls",
      title: `Unable to reach after ${count} attempts`,
      detail: `${state.patient.preferred_name} has not answered ${count} check-in calls in a row. Please try to reach them or ask someone to check in person.`,
      quote: null,
    });
    state.alerts.unshift(alert);
  }
  commit(state);
  return { consecutive_missed: count, alert: alert && snapshot(alert) };
}

export async function updateAlert(
  alertId: string,
  action: "acknowledge" | "resolve",
  by: string,
  note?: string,
): Promise<Alert> {
  if (action !== "acknowledge" && action !== "resolve") throw new StoreError("Unknown alert action.", 400);
  const who = text(by, 80) || "nurse";
  for (const state of (await states()).values()) {
    const alert = state.alerts.find((a) => a.id === alertId);
    if (!alert) continue;
    if (action === "resolve") alert.status = "resolved";
    else if (alert.status === "open") alert.status = "acknowledged";
    alert.acknowledged_by ??= who;
    const clean = text(note, 1000).trim();
    if (clean) alert.notes.push(`${who}: ${clean}`);
    commit(state);
    return snapshot(alert);
  }
  throw new StoreError("I couldn't find that alert.", 404);
}

/** Runs engine/tests (pytest, unittest fallback) inside a fresh Daytona sandbox. */
export async function runEngineTests(): Promise<TestRunResult> {
  return runTests();
}

/** Demo helper: restore the 3 seeded patients (clears new calls/alerts). */
export async function resetDemo(): Promise<void> {
  await states(); // let a first hydrate finish so it cannot overwrite the reset
  const seeded = await loadSeed();
  fill(seeded);
  saveInBackground(seeded, true);
  await withTimeout(flushRecords(), RESET_FLUSH_WAIT_MS, "reset flush slow").catch((err) =>
    console.error("[store] reset is in the cache; records sandbox still catching up", errText(err)),
  );
}
