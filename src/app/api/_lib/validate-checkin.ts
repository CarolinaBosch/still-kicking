// Validates a CheckinRecord sent by the voice agent's `submit_checkin` client tool.
// The agent's output is untrusted: every field is type-checked, range-checked and size-capped,
// and missing or malformed values become null / empty instead of failing the whole call.
import type { CheckinRecord, RedFlag, Severity, StopAndWatch } from "@/lib/types";
import { InvalidInput, boolOrNull, cleanText, numberInRange, requireId } from "./http";

const SEVERITIES: Severity[] = ["emergency", "urgent", "watch"];
const RED_FLAG_TYPES = new Set([
  "chest_pain", "breathing", "fall", "stroke_signs", "fainting", "bleeding", "safety", "confusion", "other",
]);
const STOP_AND_WATCH_KEYS: (keyof StopAndWatch)[] = [
  "seems_different", "talks_less", "needs_more_help", "ate_less", "bowel_change", "drank_less",
  "weight_or_swelling", "agitated", "tired_weak_confused", "skin_change", "walking_toileting_help",
];

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arr(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function redFlag(raw: unknown): RedFlag | null {
  const r = obj(raw);
  const typeRaw = cleanText(r.type, 40).toLowerCase().replace(/[\s-]+/g, "_");
  const quote = cleanText(r.quote, 300);
  if (!typeRaw && !quote) return null;
  const severity = SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : "urgent";
  return { type: RED_FLAG_TYPES.has(typeRaw) ? typeRaw : "other", quote, severity };
}

function conditionSpecific(raw: unknown): CheckinRecord["condition_specific"] {
  const out: CheckinRecord["condition_specific"] = {};
  for (const [k, v] of Object.entries(obj(raw)).slice(0, 30)) {
    const key = cleanText(k, 60).replace(/[^A-Za-z0-9_]/g, "_");
    if (!key) continue;
    if (v === null || typeof v === "boolean") out[key] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.max(-1e6, Math.min(1e6, v));
    else if (typeof v === "string") out[key] = cleanText(v, 200);
  }
  return out;
}

function isoOrNow(value: unknown): string {
  if (typeof value === "string" && value.length <= 40) {
    const t = Date.parse(value);
    // Accept timestamps within a day of now; anything else is the agent guessing.
    if (Number.isFinite(t) && Math.abs(t - Date.now()) < 24 * 3600 * 1000) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

export function validateCheckin(body: Record<string, unknown>): CheckinRecord {
  const patient_id = requireId(body.patient_id, "patient id");
  const call_id =
    typeof body.call_id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(body.call_id)
      ? body.call_id
      : `call_${Date.now().toString(36)}`;

  const sw = obj(body.stop_and_watch);
  const stop_and_watch = Object.fromEntries(STOP_AND_WATCH_KEYS.map((k) => [k, boolOrNull(sw[k])])) as unknown as StopAndWatch;

  const pain = obj(body.pain);
  const meds = obj(body.medication_adherence);
  const phq = numberInRange(body.phq2_score, 0, 6);
  const confidence = numberInRange(body.extraction_confidence, 0, 1);

  const record: CheckinRecord = {
    call_id,
    patient_id,
    timestamp: isoOrNow(body.timestamp),
    red_flags: arr(body.red_flags, 10).map(redFlag).filter((f): f is RedFlag => f !== null),
    stop_and_watch,
    pain: {
      present: boolOrNull(pain.present),
      location: cleanText(pain.location, 100),
      score: (() => {
        const s = numberInRange(pain.score, 0, 10);
        return s === null ? null : Math.round(s);
      })(),
      new_or_worse: boolOrNull(pain.new_or_worse),
    },
    orientation_correct: boolOrNull(body.orientation_correct),
    medication_adherence: {
      all_taken: boolOrNull(meds.all_taken),
      missed: arr(meds.missed, 20)
        .map((m) => {
          const o = obj(m);
          const med = cleanText(o.med, 80);
          if (!med) return null;
          const n = numberInRange(o.doses_missed, 0, 60);
          return { med, doses_missed: n === null ? 1 : Math.round(n), reason: cleanText(o.reason, 200) };
        })
        .filter((m): m is { med: string; doses_missed: number; reason: string } => m !== null),
      prn_use_increased: boolOrNull(meds.prn_use_increased),
      running_low: arr(meds.running_low, 20).map((s) => cleanText(s, 80)).filter(Boolean),
    },
    phq2_score: phq === null ? null : Math.round(phq),
    condition_specific: conditionSpecific(body.condition_specific),
    weight_lb: numberInRange(body.weight_lb, 50, 700),
    patient_message_for_caregiver: cleanText(body.patient_message_for_caregiver, 500),
    patient_quote: cleanText(body.patient_quote, 300),
    extraction_confidence: confidence === null ? 0.5 : confidence,
  };

  if (record.red_flags.length === 0 && Object.keys(body).length <= 1) {
    throw new InvalidInput("The check-in record was empty.");
  }
  return record;
}
