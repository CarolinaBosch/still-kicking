// Records store + engine facade. SERVER ONLY. Owner: hack-sandbox.
// API routes import ONLY these functions. Implementation: patient records live in Daytona
// (volume, or a long-lived records sandbox as fallback); every finished call is analyzed by
// engine/*.py in a fresh Daytona sandbox. These stubs are replaced by hack-sandbox.

import type {
  Alert,
  AnalysisResult,
  CheckinRecord,
  EmergencyInput,
  MissedCallResult,
  PatientState,
  TestRunResult,
} from "../types";

const todo = (name: string): never => {
  throw new Error(`store.${name} not implemented yet`);
};

/** All patients with history, attempts, alerts. Seeds the 3 synthetic patients on first use. */
export async function listPatients(): Promise<PatientState[]> {
  return todo("listPatients");
}

export async function getPatientState(patientId: string): Promise<PatientState | null> {
  void patientId;
  return todo("getPatientState");
}

/** Persists the record, runs the Daytona engine on it + history, persists the analysis and any new alerts. */
export async function analyzeCheckin(record: CheckinRecord): Promise<AnalysisResult> {
  void record;
  return todo("analyzeCheckin");
}

/** Called DURING the voice call. Creates an emergency alert + simulated SMS to nurse and caregiver. Must be fast (<2 s). */
export async function raiseEmergency(input: EmergencyInput): Promise<Alert> {
  void input;
  return todo("raiseEmergency");
}

/** Records one unanswered attempt. On the 3rd consecutive miss, creates an urgent missed_calls alert. */
export async function recordMissedCall(patientId: string): Promise<MissedCallResult> {
  void patientId;
  return todo("recordMissedCall");
}

export async function updateAlert(
  alertId: string,
  action: "acknowledge" | "resolve",
  by: string,
  note?: string,
): Promise<Alert> {
  void alertId; void action; void by; void note;
  return todo("updateAlert");
}

/** Runs engine/tests with pytest inside a fresh Daytona sandbox. */
export async function runEngineTests(): Promise<TestRunResult> {
  return todo("runEngineTests");
}

/** Demo helper: restore the 3 seeded patients (clears new calls/alerts). */
export async function resetDemo(): Promise<void> {
  return todo("resetDemo");
}
