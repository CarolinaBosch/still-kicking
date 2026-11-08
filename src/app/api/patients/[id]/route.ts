import { getPatientState } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { fail, ok, requireId, toolError, viaStore, withTimeout } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await ctx.params).id, "patient id");
    const state = await withTimeout(
      viaStore(() => getPatientState(id), () => devStore.getPatientState(id)),
      20_000,
      "getPatientState",
    );
    if (!state) return toolError("I could not find that patient.", 404);
    return ok(state);
  } catch (err) {
    return fail(err, "patient", "Could not load that patient.");
  }
}
