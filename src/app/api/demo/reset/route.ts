import { resetDemo } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { fail, ok, viaStore, withTimeout } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    await withTimeout(viaStore(resetDemo, devStore.resetDemo), 55_000, "resetDemo");
    return ok({ ok: true as const });
  } catch (err) {
    return fail(err, "demo/reset", "Could not reset the demo.");
  }
}
