import { requireUser } from "@/lib/http";
import { ApiError, getEventAccess, json, parseJson, requireEventAccess, route } from "@/lib/http";
import { deleteGroup, setPlayerGroup } from "@/lib/events";
import { z } from "zod";
import { validate } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string; groupId: string }> };

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id, groupId } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can manage groups", "forbidden");
  await deleteGroup(id, groupId);
  return json({ ok: true });
});

const assignSchema = z.object({
  playerId: z.string().min(1),
  action: z.enum(["add", "remove"]),
});

/**
 * Add or remove a player from a group.
 *
 * Requirement 4: a player marks their own tee group without an admin. So this
 * uses `getEventAccess` (which returns null instead of throwing for a
 * non-admin) and allows the self case through - `setPlayerGroup` then applies
 * the self-entry rules (must be entered, four-ball cap).
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id, groupId } = await ctx.params;
  const user = await requireUser();
  const access = await getEventAccess(id, user);
  const body = validate(assignSchema, await parseJson(request));
  const isSelf = user.playerId === body.playerId;
  if (!access?.isAdmin && !isSelf) {
    throw new ApiError(403, "Only event admins can move other players", "forbidden");
  }

  const result = await setPlayerGroup({
    eventId: id,
    playerId: body.playerId,
    groupId: body.action === "add" ? groupId : null,
    isAdmin: Boolean(access?.isAdmin),
  });
  return json(result);
});
