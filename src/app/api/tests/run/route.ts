import { runEngineTests } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { fail, ok, viaStore, withTimeout } from "../../_lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST() {
  try {
    const result = await withTimeout(viaStore(runEngineTests, devStore.runEngineTests), 170_000, "runEngineTests");
    return ok(result);
  } catch (err) {
    return fail(err, "tests/run", "The test run in Daytona did not finish.");
  }
}
