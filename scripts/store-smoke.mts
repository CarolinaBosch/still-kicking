// Smoke test of the Daytona-backed store against the real Daytona API.
// Run: node_modules/.bin/jiti scripts/store-smoke.mts   (reads .env.local; never prints keys)

import type { CheckinRecord } from "../src/lib/types";

process.loadEnvFile(".env.local");

const store = await import("../src/lib/store/index");
const records = await import("../src/lib/daytona/records");

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const out = await fn();
  console.log(`${label.padEnd(34)} ${String(Date.now() - t).padStart(6)} ms`);
  return out;
}

const patients = await timed("listPatients (cold)", () => store.listPatients());
console.log("  records sandbox:", await records.recordsSandboxId());
console.log("  patients:", patients.map((p) => `${p.patient.id}=${p.status} (${p.history.length} calls)`).join(", "));
await timed("listPatients (warm)", () => store.listPatients());
await timed("resetDemo", () => store.resetDemo());

const p2Record: CheckinRecord = {
  call_id: `smoke-${Date.now()}`,
  patient_id: "p2",
  timestamp: new Date().toISOString(),
  red_flags: [],
  stop_and_watch: {
    seems_different: false, talks_less: false, needs_more_help: false, ate_less: false, bowel_change: false, drank_less: false,
    weight_or_swelling: true, agitated: false, tired_weak_confused: false, skin_change: false, walking_toileting_help: false,
  },
  pain: { present: false, location: "", score: 2, new_or_worse: false },
  orientation_correct: true,
  medication_adherence: {
    all_taken: false,
    missed: [{ med: "furosemide", doses_missed: 1, reason: "didn't want to keep going to the bathroom" }],
    prn_use_increased: false,
    running_low: [],
  },
  phq2_score: 1,
  condition_specific: { ankle_swelling: true, sob_lying_flat: true },
  weight_lb: 186.5,
  patient_message_for_caregiver: "Tell Maria not to fuss.",
  patient_quote: "My shoes don't fit and I had to sleep in the chair.",
  extraction_confidence: 0.9,
};
const analysis = await timed("analyzeCheckin p2 (engine sandbox)", () => store.analyzeCheckin(p2Record));
console.log("  engine sandbox:", analysis.sandbox_id, `${analysis.sandbox_ms} ms`);
console.log("  status:", analysis.summary.status, "| alerts:", analysis.new_alerts.map((a) => a.title).join("; "));
for (const f of analysis.findings) console.log(`  finding: ${f.pattern} -> ${f.attribution} (${f.severity}): ${f.reason}`);
console.log("  trend flags:", analysis.trend_flags.join(" | "));
console.log("  summary:", JSON.stringify(analysis.summary));

for (let i = 1; i <= 3; i++) {
  const r = await timed(`recordMissedCall p1 #${i}`, () => store.recordMissedCall("p1"));
  console.log(`  consecutive=${r.consecutive_missed} alert=${r.alert?.title ?? "none"}`);
}

const emergency = await timed("raiseEmergency p3", () =>
  store.raiseEmergency({ patient_id: "p3", red_flag: "chest_pain", quote: "I have chest pain" }),
);
console.log("  ", emergency.title, "| sms:", emergency.sms_log.map((s) => `${s.to}: ${s.text}`).join(" || "));
const acked = await timed("updateAlert acknowledge", () => store.updateAlert(emergency.id, "acknowledge", "Nurse Sam", "Called 911 with patient"));
console.log("  ", acked.status, acked.notes);

const tests = await timed("runEngineTests (tests sandbox)", () => store.runEngineTests());
console.log(`  ${tests.passed} passed, ${tests.failed} failed, sandbox ${tests.sandbox_id}, ${tests.sandbox_ms} ms`);
console.log(tests.output_tail.split("\n").slice(-4).map((l) => `  | ${l}`).join("\n"));

await timed("flush writes to records sandbox", () => records.flushRecords());
const persisted = await timed("loadRecords from records sandbox", () => records.loadRecords());
const p2 = persisted?.find((s) => s.patient.id === "p2");
console.log("  persisted p2 calls:", p2?.history.length, "| p3 alerts:", persisted?.find((s) => s.patient.id === "p3")?.alerts.length);

await timed("resetDemo (leave clean)", () => store.resetDemo());
