import { updateAlert } from "@/lib/store";
import { devStore } from "@/lib/dev-fixture";
import { InvalidInput, cleanText, fail, ok, readJsonObject, requireId, viaStore, withTimeout } from "../../_lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await ctx.params).id, "alert id");
    const body = await readJsonObject(req);
    const action = body.action;
    if (action !== "acknowledge" && action !== "resolve") {
      throw new InvalidInput("Action must be acknowledge or resolve.");
    }
    const by = cleanText(body.by, 60);
    if (!by) throw new InvalidInput("Who is acting on this alert?");
    const note = cleanText(body.note, 500) || undefined;
    const alert = await withTimeout(
      viaStore(() => updateAlert(id, action, by, note), () => devStore.updateAlert(id, action, by, note)),
      20_000,
      "updateAlert",
    );
    return ok(alert);
  } catch (err) {
    return fail(err, "alerts", "Could not update that alert.");
  }
}
