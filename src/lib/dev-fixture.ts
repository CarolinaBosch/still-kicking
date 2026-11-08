// DEV ONLY. In-memory stand-in for the Daytona store, used by the API routes exclusively when
// NODE_ENV === "development" AND the real store still throws "not implemented" (see viaStore in
// src/app/api/_lib/http.ts). Responses served from here carry the x-dev-fixture header and the
// dashboard shows a "Dev fixture data" banner, so it can never pass for real Daytona output.
// Synthetic patients only.

import type {
  Alert,
  AnalysisResult,
  CheckinRecord,
  EmergencyInput,
  MissedCallResult,
  Patient,
  PatientState,
  StopAndWatch,
  TestRunResult,
} from "./types";

export const DEV_FIXTURE_HEADER = "x-dev-fixture";

// Kept on globalThis so every route bundle in `next dev` shares one fixture state.
type FixtureGlobal = { active: boolean; states: PatientState[] | null; alertSeq: number };
const g = globalThis as unknown as { __stillKickingFixture?: FixtureGlobal };
const fx: FixtureGlobal = (g.__stillKickingFixture ??= { active: false, states: null, alertSeq: 1 });

export function markDevFixture() {
  fx.active = true;
}
export function isDevFixtureActive() {
  return fx.active;
}

const DAY = 24 * 3600 * 1000;

const NEG_SW: StopAndWatch = {
  seems_different: false, talks_less: false, needs_more_help: false, ate_less: false, bowel_change: false,
  drank_less: false, weight_or_swelling: false, agitated: false, tired_weak_confused: false,
  skin_change: false, walking_toileting_help: false,
};

const PATIENTS: Patient[] = [
  {
    id: "p1", name: "Eleanor Hayes", preferred_name: "Ellie", age: 81, language: "en", tone: "cheerful",
    address: "12 Synthetic Lane, Springfield", conditions: ["hypertension", "osteoarthritis"],
    medications: [
      { name: "Amlodipine", dose: "5 mg", schedule: "every morning", purpose: "blood pressure", med_class: "bp", prn: false },
      { name: "Acetaminophen", dose: "500 mg", schedule: "as needed", purpose: "knee pain", med_class: "pain", prn: true },
    ],
    allergies: ["penicillin"],
    caregiver: { name: "Daniel Hayes", relationship: "son", phone: "555-0101" },
    nurse: { name: "Maria", phone: "555-0199" },
    baseline: { mobility: "walks with a cane", appetite: "good", sleep: "7 hours", memory: "sharp", mood: "upbeat", weight_lb: 142, usual_pain_score: 3 },
    next_call_time: "tomorrow at 10:00 AM",
  },
  {
    id: "p2", name: "Walter Brooks", preferred_name: "Walt", age: 78, language: "en", tone: "calm",
    address: "48 Example Street, Springfield", conditions: ["heart failure", "hypertension", "diabetes"],
    medications: [
      { name: "Furosemide", dose: "40 mg", schedule: "every morning", purpose: "fluid / swelling", med_class: "diuretic", prn: false },
      { name: "Metformin", dose: "500 mg", schedule: "twice daily", purpose: "blood sugar", med_class: "diabetes", prn: false },
      { name: "Lisinopril", dose: "10 mg", schedule: "every morning", purpose: "blood pressure", med_class: "bp", prn: false },
    ],
    allergies: [],
    caregiver: { name: "Linda Brooks", relationship: "daughter", phone: "555-0102" },
    nurse: { name: "Maria", phone: "555-0199" },
    baseline: { mobility: "independent", appetite: "fair", sleep: "6 hours, two pillows", memory: "sharp", mood: "steady", weight_lb: 196, usual_pain_score: 1 },
    next_call_time: "tomorrow at 9:30 AM",
  },
  {
    id: "p3", name: "Rosa Delgado", preferred_name: "Rosa", age: 86, language: "en", tone: "calm",
    address: "7 Placeholder Court, Springfield", conditions: ["dementia/MCI", "diabetes"],
    medications: [
      { name: "Donepezil", dose: "10 mg", schedule: "every evening", purpose: "memory", med_class: "other", prn: false },
      { name: "Glipizide", dose: "5 mg", schedule: "every morning", purpose: "blood sugar", med_class: "diabetes", prn: false },
    ],
    allergies: ["sulfa"],
    caregiver: { name: "Ana Delgado", relationship: "granddaughter", phone: "555-0103" },
    nurse: { name: "Maria", phone: "555-0199" },
    baseline: { mobility: "walker indoors", appetite: "small meals", sleep: "8 hours", memory: "mild forgetfulness", mood: "content", weight_lb: 121, usual_pain_score: 2 },
    next_call_time: "today at 4:00 PM",
  },
];

function record(p: Patient, daysAgo: number, patch: Partial<CheckinRecord> = {}): CheckinRecord {
  const ts = new Date(Date.now() - daysAgo * DAY);
  ts.setHours(10, 5, 0, 0);
  return {
    call_id: `seed_${p.id}_${daysAgo}`,
    patient_id: p.id,
    timestamp: ts.toISOString(),
    red_flags: [],
    stop_and_watch: { ...NEG_SW },
    pain: { present: false, location: "", score: null, new_or_worse: false },
    orientation_correct: true,
    medication_adherence: { all_taken: true, missed: [], prn_use_increased: false, running_low: [] },
    phq2_score: 0,
    condition_specific: {},
    weight_lb: p.baseline.weight_lb,
    patient_message_for_caregiver: "",
    patient_quote: "Doing fine today.",
    extraction_confidence: 0.92,
    ...patch,
  };
}

function seedHistory(p: Patient): CheckinRecord[] {
  const out: CheckinRecord[] = [];
  for (let d = 14; d >= 1; d--) {
    if (p.id === "p1") {
      out.push(record(p, d, d === 6 ? { pain: { present: true, location: "knee", score: 4, new_or_worse: false } } : {}));
    } else if (p.id === "p2") {
      const missed = d <= 3;
      out.push(record(p, d, {
        stop_and_watch: { ...NEG_SW, weight_or_swelling: d <= 3 },
        medication_adherence: missed
          ? { all_taken: false, missed: [{ med: "Furosemide", doses_missed: 1, reason: "too many bathroom trips" }], prn_use_increased: false, running_low: [] }
          : { all_taken: true, missed: [], prn_use_increased: false, running_low: [] },
        weight_lb: 196 + (d <= 3 ? 4 - d : 0),
        condition_specific: { ankle_swelling: d <= 3, sob_lying_flat: false },
        patient_quote: d <= 3 ? "My ankles are puffy, I skipped the water pill." : "Feeling alright.",
      }));
    } else {
      const confused = d <= 2;
      out.push(record(p, d, {
        orientation_correct: !confused,
        stop_and_watch: { ...NEG_SW, seems_different: confused, tired_weak_confused: confused, drank_less: confused },
        condition_specific: { urinary_burning: confused },
        patient_quote: confused ? "I don't know what day it is, it burns when I go." : "Same as always, dear.",
      }));
    }
  }
  return out;
}

function analysisFor(p: Patient, call_id: string): AnalysisResult | null {
  if (p.id === "p2") {
    return {
      patient_id: p.id, call_id,
      findings: [{
        pattern: "possible heart failure worsening",
        evidence: ["swelling on 3 of last 3 calls", "weight +3 lb in 3 days"],
        attribution: "likely_adherence_related",
        reason: "Furosemide missed on 3 of the last 3 days.",
        severity: "urgent",
      }],
      trend_flags: ["swelling positive on 3 of last 3 calls"],
      summary: {
        status: "yellow",
        today: "Walt is in good spirits but his ankles are swollen.",
        what_changed: ["Ankle swelling for 3 days", "Weight up 3 lb since Monday"],
        medications: "He has skipped his water pill (Furosemide) for 3 mornings because of bathroom trips.",
        patterns_to_watch: ["Swelling together with missed water pill: the nurse will review"],
        in_their_words: "My ankles are puffy, I skipped the water pill.",
        next_call: p.next_call_time,
      },
      new_alerts: [], sandbox_id: "dev-fixture", sandbox_ms: 0,
    };
  }
  if (p.id === "p3") {
    return {
      patient_id: p.id, call_id,
      findings: [{
        pattern: "new confusion with urinary symptoms",
        evidence: ["orientation wrong on 2 of last 2 calls", "urinary burning reported", "drinking less"],
        attribution: "likely_clinical_change",
        reason: "Medications taken as scheduled; change is new against her baseline.",
        severity: "urgent",
      }],
      trend_flags: ["orientation incorrect on 2 of last 2 calls"],
      summary: {
        status: "red",
        today: "Rosa seemed more confused than usual and mentioned burning when she urinates.",
        what_changed: ["Did not know the day (usually does)", "Burning when urinating", "Drinking less water"],
        medications: "All medications taken.",
        patterns_to_watch: ["New confusion with urinary symptoms: the nurse will review today"],
        in_their_words: "I don't know what day it is, it burns when I go.",
        next_call: p.next_call_time,
      },
      new_alerts: [], sandbox_id: "dev-fixture", sandbox_ms: 0,
    };
  }
  return {
    patient_id: p.id, call_id, findings: [], trend_flags: [],
    summary: {
      status: "green", today: "Ellie is doing well and enjoyed her walk.", what_changed: [],
      medications: "All medications taken.", patterns_to_watch: [], in_their_words: "Doing fine today.",
      next_call: p.next_call_time,
    },
    new_alerts: [], sandbox_id: "dev-fixture", sandbox_ms: 0,
  };
}

function fresh(): PatientState[] {
  return PATIENTS.map((p) => {
    const history = seedHistory(p);
    const last = history[history.length - 1];
    const analysis = analysisFor(p, last.call_id);
    return {
      patient: p,
      status: analysis?.summary.status ?? "green",
      history,
      attempts: history.map((h) => ({ patient_id: p.id, at: h.timestamp, answered: true })),
      alerts: [],
      last_analysis: analysis,
    };
  });
}

function getStates(): PatientState[] {
  return (fx.states ??= fresh());
}

function find(patientId: string): PatientState {
  const s = getStates().find((x) => x.patient.id === patientId);
  if (!s) throw new Error(`unknown patient ${patientId} (not found)`);
  return s;
}

function sms(p: Patient, text: string): Alert["sms_log"] {
  const at = new Date().toISOString();
  return [
    { to: "nurse", name: p.nurse.name, at, text },
    { to: "caregiver", name: p.caregiver.name, at, text },
  ];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const devStore = {
  async listPatients(): Promise<PatientState[]> {
    return clone(getStates());
  },
  async getPatientState(id: string): Promise<PatientState | null> {
    const s = getStates().find((x) => x.patient.id === id);
    return s ? clone(s) : null;
  },
  async analyzeCheckin(rec: CheckinRecord): Promise<AnalysisResult> {
    const s = find(rec.patient_id);
    s.history.push(rec);
    s.attempts.push({ patient_id: s.patient.id, at: rec.timestamp, answered: true });
    const a = analysisFor(s.patient, rec.call_id)!;
    s.last_analysis = a;
    s.status = a.summary.status;
    return clone(a);
  },
  async raiseEmergency(input: EmergencyInput): Promise<Alert> {
    const s = find(input.patient_id);
    const p = s.patient;
    const alert: Alert = {
      id: `dev_alert_${fx.alertSeq++}`, patient_id: p.id, severity: "emergency", kind: "red_flag",
      title: `${input.red_flag.replace(/_/g, " ")} reported during call`,
      detail: `${p.preferred_name} was told to call 911 now.`,
      quote: input.quote, created_at: new Date().toISOString(), status: "open", acknowledged_by: null, notes: [],
      sms_log: sms(p, `URGENT: ${p.preferred_name} reported ${input.red_flag.replace(/_/g, " ")}: "${input.quote}". Advised to call 911.`),
    };
    s.alerts.push(alert);
    s.status = "red";
    return clone(alert);
  },
  async recordMissedCall(id: string): Promise<MissedCallResult> {
    const s = find(id);
    s.attempts.push({ patient_id: id, at: new Date().toISOString(), answered: false });
    let n = 0;
    for (let i = s.attempts.length - 1; i >= 0 && !s.attempts[i].answered; i--) n++;
    let alert: Alert | null = null;
    if (n === 3) {
      const p = s.patient;
      alert = {
        id: `dev_alert_${fx.alertSeq++}`, patient_id: id, severity: "urgent", kind: "missed_calls",
        title: "Unable to reach after 3 attempts", detail: "Three consecutive check-in calls went unanswered.",
        quote: null, created_at: new Date().toISOString(), status: "open", acknowledged_by: null, notes: [],
        sms_log: sms(p, `Could not reach ${p.preferred_name} after 3 calls. Please check in.`),
      };
      s.alerts.push(alert);
      s.status = "red";
    }
    return { consecutive_missed: n, alert: alert ? clone(alert) : null };
  },
  async updateAlert(alertId: string, action: "acknowledge" | "resolve", by: string, note?: string): Promise<Alert> {
    for (const s of getStates()) {
      const a = s.alerts.find((x) => x.id === alertId);
      if (!a) continue;
      a.status = action === "resolve" ? "resolved" : a.status === "resolved" ? "resolved" : "acknowledged";
      a.acknowledged_by = a.acknowledged_by ?? by;
      if (note) a.notes.push(`${by}: ${note}`);
      return clone(a);
    }
    throw new Error(`unknown alert ${alertId} (not found)`);
  },
  async runEngineTests(): Promise<TestRunResult> {
    await new Promise((r) => setTimeout(r, 800));
    return {
      passed: 0, failed: 0, sandbox_id: "dev-fixture", sandbox_ms: 0,
      output_tail: "DEV FIXTURE: the Daytona test runner is not implemented yet. No tests were run.",
    };
  },
  async resetDemo(): Promise<void> {
    fx.states = fresh();
  },
};
