import { recordMissedCall } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { fail, ok, readJsonObject, requireId, viaStore, withTimeout } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const id = requireId((await readJsonObject(req)).patient_id, "patient id");
    const result = await withTimeout(
      viaStore(() => recordMissedCall(id), () => devStore.recordMissedCall(id)),
      20_000,
      "recordMissedCall",
    );
    return ok(result);
  } catch (err) {
    return fail(err, "calls/missed", "Could not record the missed call.");
  }
}
