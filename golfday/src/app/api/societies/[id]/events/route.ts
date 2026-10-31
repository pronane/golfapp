import { z } from "zod";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { attachEventToSociety, detachEventFromSociety, listSocietyEvents, requireSocietyRole } from "@/lib/societies";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const linkSchema = z.object({ eventId: z.string().min(1) });

/** Put one of your golf days on the society's fixture list. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireSocietyRole(user, id);
  const body = validate(linkSchema, await parseJson(request));
  const access = await requireEventAccess(body.eventId, user);
  if (!access.isAdmin) throw new ApiError(403, "You need to run that golf day to add it to a society", "forbidden");
  await attachEventToSociety(id, body.eventId);
  return json({ ok: true, fixtures: await listSocietyEvents(id) });
});

/** Remove a fixture from the society (the golf day itself is untouched). */
export const DELETE = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireSocietyRole(user, id);
  const body = validate(linkSchema, await parseJson(request));
  await detachEventFromSociety(id, body.eventId);
  return json({ ok: true, fixtures: await listSocietyEvents(id) });
});
