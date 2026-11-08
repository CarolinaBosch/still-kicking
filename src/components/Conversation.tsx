// Voice-call plumbing for the Still Kicking Nurse: dynamic variables for the session, and defensive
// normalization of the agent's client-tool arguments into the shared contract (src/lib/types.ts).
// The LLM may omit fields, send strings for numbers, or invent extra keys; the API routes validate,
// so everything sent there is shaped here first. Tool names match scripts/create-agent.mjs.

import type {
  CheckinRecord,
  EmergencyInput,
  Patient,
  RedFlag,
  Severity,
  StopAndWatch,
} from "@/lib/types";

export const TOOL_EMERGENCY = "trigger_emergency_alert";
export const TOOL_SUBMIT = "submit_checkin";

const SAW_KEYS: (keyof StopAndWatch)[] = [
  "seems_different",
  "talks_less",
  "needs_more_help",
  "ate_less",
  "bowel_change",
  "drank_less",
  "weight_or_swelling",
  "agitated",
  "tired_weak_confused",
  "skin_change",
  "walking_toileting_help",
];

const RED_FLAG_TYPES = new Set([
  "chest_pain",
  "breathing",
  "fall",
  "stroke_signs",
  "fainting",
  "bleeding",
  "safety",
  "confusion",
  "other",
]);

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => {
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Obj) : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
};

const asArr = (v: unknown): unknown[] => {
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
};

const str = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "";

const boolOrNull = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "y"].includes(s)) return true;
    if (["false", "no", "n"].includes(s)) return false;
  }
  return null;
};

const numOrNull = (v: unknown, min?: number, max?: number): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.+-]/g, "")) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || (typeof v === "string" && v.trim() === "")) return null;
  let out = n;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
};

const normalizeFlagType = (v: unknown): string => {
  const s = str(v, 40).toLowerCase().replace(/[\s-]+/g, "_");
  return RED_FLAG_TYPES.has(s) ? s : "other";
};

const normalizeSeverity = (v: unknown): Severity => {
  const s = str(v, 20).toLowerCase();
  return s === "urgent" || s === "watch" ? s : "emergency";
};

/** Values for the agent's {{variables}}. Strings only, so the SDK and the prompt agree. */
export function buildDynamicVariables(patient: Patient): Record<string, string> {
  const meds = patient.medications
    .map((m) => `${m.name} ${m.dose} ${m.schedule}${m.prn ? " (as needed)" : ""} for ${m.purpose}`)
    .join("; ");
  return {
    patient_id: patient.id,
    preferred_name: patient.preferred_name || patient.name,
    tone: patient.tone,
    language: patient.language,
    caregiver_name: patient.caregiver?.name || "your family",
    medications: meds || "no medicines on file",
    conditions: patient.conditions.length ? patient.conditions.join(", ") : "none listed",
    next_call_time: patient.next_call_time || "tomorrow",
    today_weekday: new Date().toLocaleDateString("en-US", { weekday: "long" }),
  };
}

/** trigger_emergency_alert arguments → EmergencyInput. patient_id always comes from the page, not the LLM. */
export function toEmergencyInput(params: Obj, patientId: string): EmergencyInput {
  return {
    patient_id: patientId,
    red_flag: normalizeFlagType(params.red_flag),
    quote: str(params.quote) || "(no exact quote captured)",
  };
}

/** submit_checkin arguments → full CheckinRecord. Missing items become null / empty, never guesses. */
export function toCheckinRecord(params: Obj, patientId: string, callId: string): CheckinRecord {
  const sawIn = asObj(params.stop_and_watch);
  const stop_and_watch = Object.fromEntries(SAW_KEYS.map((k) => [k, boolOrNull(sawIn[k])])) as unknown as StopAndWatch;

  const red_flags: RedFlag[] = asArr(params.red_flags)
    .map(asObj)
    .filter((f) => str(f.type) || str(f.quote))
    .map((f) => ({ type: normalizeFlagType(f.type), quote: str(f.quote), severity: normalizeSeverity(f.severity) }));

  const painIn = asObj(params.pain);
  const score = numOrNull(painIn.score, 0, 10);
  const pain = {
    present: boolOrNull(painIn.present),
    location: str(painIn.location, 120),
    score: score === null ? null : Math.round(score),
    new_or_worse: boolOrNull(painIn.new_or_worse),
  };

  const medIn = asObj(params.medication_adherence);
  const missed = asArr(medIn.missed)
    .map(asObj)
    .filter((m) => str(m.med))
    .map((m) => ({
      med: str(m.med, 80),
      doses_missed: Math.max(1, Math.round(numOrNull(m.doses_missed, 0, 20) ?? 1)),
      reason: str(m.reason, 200),
    }));
  const medication_adherence = {
    all_taken: missed.length ? false : boolOrNull(medIn.all_taken),
    missed,
    prn_use_increased: boolOrNull(medIn.prn_use_increased),
    running_low: asArr(medIn.running_low).map((x) => str(x, 80)).filter(Boolean),
  };

  const condition_specific: CheckinRecord["condition_specific"] = {};
  for (const [k, v] of Object.entries(asObj(params.condition_specific))) {
    const key = k.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40);
    if (!key) continue;
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) condition_specific[key] = v;
    else if (typeof v === "string" && v.trim()) condition_specific[key] = v.trim().slice(0, 120);
  }

  const phq = numOrNull(params.phq2_score, 0, 6);
  const confidence = numOrNull(params.extraction_confidence, 0, 1);

  return {
    call_id: callId,
    patient_id: patientId,
    timestamp: new Date().toISOString(),
    red_flags,
    stop_and_watch,
    pain,
    orientation_correct: boolOrNull(params.orientation_correct),
    medication_adherence,
    phq2_score: phq === null ? null : Math.round(phq),
    condition_specific,
    weight_lb: numOrNull(params.weight_lb, 50, 700),
    patient_message_for_caregiver: str(params.patient_message_for_caregiver),
    patient_quote: str(params.patient_quote, 300),
    extraction_confidence: confidence ?? 0.5,
  };
}

export function newCallId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `call_${Date.now()}_${rand}`;
}
