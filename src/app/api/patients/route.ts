import { listPatients } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { fail, ok, viaStore, withTimeout } from "../_lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const states = await withTimeout(viaStore(listPatients, devStore.listPatients), 20_000, "listPatients");
    return ok(states);
  } catch (err) {
    return fail(err, "patients", "Could not load patients.");
  }
}
