import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, groups } from "@/db/schema";
import { requireUser } from "@/lib/http";
import { ApiError, json, parseJson, requireEventAccess, route } from "@/lib/http";
import { bumpRevision, deleteGroup } from "@/lib/events";
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

/** Add or remove a player from a group (a player can set their own group too). */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id, groupId } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  const body = validate(assignSchema, await parseJson(request));
  const isSelf = user.playerId === body.playerId;
  if (!access.isAdmin && !isSelf) throw new ApiError(403, "Only event admins can move other players", "forbidden");

  const [group] = await db.select().from(groups).where(and(eq(groups.id, groupId), eq(groups.eventId, id))).limit(1);
  if (!group) throw new ApiError(404, "Group not found", "not_found");

  const [registration] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, id), eq(eventPlayers.playerId, body.playerId)))
    .limit(1);
  if (!registration) throw new ApiError(404, "That player is not registered for this event", "not_found");

  await db
    .update(eventPlayers)
    .set({ groupId: body.action === "add" ? group.id : null })
    .where(eq(eventPlayers.id, registration.id));
  await bumpRevision(id);
  return json({ ok: true, groupId: body.action === "add" ? group.id : null });
});
