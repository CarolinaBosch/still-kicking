// Client tool `trigger_emergency_alert`, called DURING the voice call. Must answer fast.
import { raiseEmergency } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import type { EmergencyInput } from "@/lib/types";
import { InvalidInput, cleanText, ok, readJsonObject, requireId, toolError, viaStore, withTimeout } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// The agent speaks this if the alert could not be stored: the patient must still hear "call 911".
const FAILED = "I could not reach the nurse system. Please call 911 now.";

export async function POST(req: Request) {
  let input: EmergencyInput;
  try {
    const body = await readJsonObject(req);
    const red_flag = cleanText(body.red_flag, 40).toLowerCase().replace(/[\s-]+/g, "_") || "other";
    input = {
      patient_id: requireId(body.patient_id, "patient id"),
      red_flag: /^[a-z_]{1,40}$/.test(red_flag) ? red_flag : "other",
      quote: cleanText(body.quote, 300),
    };
  } catch (err) {
    const msg = err instanceof InvalidInput ? `${err.message} Please call 911 now.` : FAILED;
    return toolError(msg, 400);
  }
  try {
    const alert = await withTimeout(
      viaStore(() => raiseEmergency(input), () => devStore.raiseEmergency(input)),
      5_000,
      "raiseEmergency",
    );
    return ok(alert);
  } catch (err) {
    console.error("[emergency]", err instanceof Error ? err.message : err);
    return toolError(FAILED, 502);
  }
}
