// Client tool `submit_checkin`: persists the record and runs the Daytona engine on it.
import { analyzeCheckin } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { fail, ok, readJsonObject, viaStore, withTimeout } from "../../_lib/http";
import { validateCheckin } from "../../_lib/validate-checkin";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const record = validateCheckin(await readJsonObject(req));
    const result = await withTimeout(
      viaStore(() => analyzeCheckin(record), () => devStore.analyzeCheckin(record)),
      80_000,
      "analyzeCheckin",
    );
    return ok(result);
  } catch (err) {
    return fail(err, "calls/complete", "The check-in analysis did not finish. The nurse will follow up.");
  }
}
