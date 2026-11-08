// Shared contract for Still Kicking. Voice client, API routes, Daytona records store and engine all use it.
// Change this file only on main (hack-lead), never in a worktree.

export type Severity = "emergency" | "urgent" | "watch";
export type TrafficLight = "green" | "yellow" | "red";

export type MedClass =
  | "diuretic"
  | "inhaler"
  | "bp"
  | "diabetes"
  | "anticoagulant"
  | "heart"
  | "pain"
  | "other";

export interface Medication {
  name: string; // "Furosemide"
  dose: string; // "40 mg"
  schedule: string; // "every morning"
  purpose: string; // "fluid / swelling"
  med_class: MedClass; // used for adherence attribution
  prn: boolean; // as-needed
}

export interface Baseline {
  mobility: string; // "walks with a cane"
  appetite: string;
  sleep: string;
  memory: string; // "sharp" | "mild forgetfulness" ...
  mood: string;
  weight_lb: number | null;
  usual_pain_score: number; // 0-10
}

export interface Patient {
  id: string; // "p1"
  name: string; // synthetic only
  preferred_name: string;
  age: number;
  language: "en" | "es";
  tone: "cheerful" | "calm";
  address: string; // synthetic
  conditions: string[]; // "heart failure", "COPD", "diabetes", "hypertension", "dementia/MCI", ...
  medications: Medication[];
  allergies: string[];
  caregiver: { name: string; relationship: string; phone: string };
  nurse: { name: string; phone: string };
  baseline: Baseline;
  next_call_time: string; // "tomorrow at 10:00 AM"
}

export interface RedFlag {
  type: string; // "chest_pain" | "breathing" | "fall" | "stroke_signs" | "fainting" | "bleeding" | "safety" | "confusion" | "other"
  quote: string; // patient's exact words
  severity: Severity;
}

/** Stop and Watch items: true = positive, false = negative, null = not asked / unclear. */
export interface StopAndWatch {
  seems_different: boolean | null;
  talks_less: boolean | null;
  needs_more_help: boolean | null;
  ate_less: boolean | null;
  bowel_change: boolean | null;
  drank_less: boolean | null;
  weight_or_swelling: boolean | null;
  agitated: boolean | null;
  tired_weak_confused: boolean | null;
  skin_change: boolean | null;
  walking_toileting_help: boolean | null;
}

/** One daily check-in, structured. Sent by the voice agent's `submit_checkin` client tool at the end of a call,
 *  and also the shape of the seeded 14-day history. */
export interface CheckinRecord {
  call_id: string;
  patient_id: string;
  timestamp: string; // ISO
  red_flags: RedFlag[];
  stop_and_watch: StopAndWatch;
  pain: { present: boolean | null; location: string; score: number | null; new_or_worse: boolean | null };
  orientation_correct: boolean | null;
  medication_adherence: {
    all_taken: boolean | null;
    missed: { med: string; doses_missed: number; reason: string }[];
    prn_use_increased: boolean | null;
    running_low: string[];
  };
  phq2_score: number | null; // 0-6
  condition_specific: Record<string, string | number | boolean | null>; // e.g. { weight_gain_lb: 3, sob_lying_flat: true, urinary_burning: true }
  weight_lb: number | null;
  patient_message_for_caregiver: string;
  patient_quote: string; // one short quote for the summary
  extraction_confidence: number; // 0..1
}

export interface CallAttempt {
  patient_id: string;
  at: string; // ISO
  answered: boolean;
}

export interface SmsLogEntry {
  to: string; // "nurse" | "caregiver"
  name: string;
  at: string;
  text: string; // simulated SMS (no real SMS in this build)
}

export interface Alert {
  id: string;
  patient_id: string;
  severity: Severity;
  kind: "red_flag" | "missed_calls" | "pattern";
  title: string; // "Chest pain reported during call"
  detail: string;
  quote: string | null;
  created_at: string;
  status: "open" | "acknowledged" | "resolved";
  acknowledged_by: string | null;
  notes: string[];
  sms_log: SmsLogEntry[];
}

export type Attribution = "likely_adherence_related" | "likely_clinical_change" | "unclear";

export interface PatternFinding {
  pattern: string; // "possible heart failure worsening"
  evidence: string[]; // "swelling on 3 of last 3 calls", "weight +4 lb this week"
  attribution: Attribution;
  reason: string; // one sentence: "Furosemide missed 2 days in the last 72 h"
  severity: Severity;
}

export interface CaregiverSummary {
  status: TrafficLight;
  today: string; // one sentence
  what_changed: string[];
  medications: string;
  patterns_to_watch: string[]; // phrased as "the nurse will review"
  in_their_words: string;
  next_call: string;
}

/** Output of one Daytona engine run on a finished call. */
export interface AnalysisResult {
  patient_id: string;
  call_id: string;
  findings: PatternFinding[];
  trend_flags: string[]; // "swelling positive on 3 of last 3 calls"
  summary: CaregiverSummary;
  new_alerts: Alert[];
  sandbox_id: string; // shown on screen
  sandbox_ms: number;
}

/** Everything the dashboard needs about one patient. */
export interface PatientState {
  patient: Patient;
  status: TrafficLight;
  history: CheckinRecord[]; // oldest first, includes seeded 14 days
  attempts: CallAttempt[];
  alerts: Alert[];
  last_analysis: AnalysisResult | null;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  output_tail: string; // last ~30 lines of pytest output
  sandbox_id: string;
  sandbox_ms: number;
}

export interface MissedCallResult {
  consecutive_missed: number;
  alert: Alert | null; // set on the 3rd consecutive miss
}

/** Input of the voice agent's `trigger_emergency_alert` client tool. */
export interface EmergencyInput {
  patient_id: string;
  red_flag: string;
  quote: string;
}

export interface ToolError {
  error: string; // short, speakable
}
