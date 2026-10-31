import { z } from "zod";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import {
  addSocietyMember,
  getMembership,
  isLastOwner,
  listSocietyMembers,
  removeSocietyMember,
  requireSocietyRole,
} from "@/lib/societies";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const addSchema = z.object({
  playerId: z.string().min(1),
  role: z.enum(["MEMBER", "SECRETARY"]).default("MEMBER"),
});

/** Secretary tools: put a player on the roster. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireSocietyRole(user, id);
  const body = validate(addSchema, await parseJson(request));
  const result = await addSocietyMember(id, body.playerId, body.role);
  return json({ ...result, members: await listSocietyMembers(id) });
});

const removeSchema = z.object({ playerId: z.string().min(1) });

/**
 * Remove a member. A member may always leave themselves (unless they are the
 * last owner); removing somebody else is a secretary job.
 */
export const DELETE = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const body = validate(removeSchema, await parseJson(request));
  const own = await getMembership(id, user);
  const removingSelf = own?.playerId === body.playerId;
  if (!removingSelf) await requireSocietyRole(user, id);
  if (await isLastOwner(id, body.playerId)) {
    throw new ApiError(409, "The last owner cannot leave - make somebody else an owner first", "last_owner");
  }
  await removeSocietyMember(id, body.playerId);
  return json({ ok: true, members: await listSocietyMembers(id) });
});
