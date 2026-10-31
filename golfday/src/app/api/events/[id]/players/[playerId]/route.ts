import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers } from "@/db/schema";
import { requireUser } from "@/lib/http";
import { ApiError, getEventAccess, json, route } from "@/lib/http";
import { bumpRevision } from "@/lib/events";

type Ctx = { params: Promise<{ id: string; playerId: string }> };

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id, playerId } = await ctx.params;
  const user = await requireUser();
  const access = await getEventAccess(id, user);
  const isSelf = user.playerId === playerId;
  if (!access?.isAdmin && !isSelf) throw new ApiError(403, "Not allowed", "forbidden");

  const [row] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, id), eq(eventPlayers.playerId, playerId)))
    .limit(1);
  if (!row) throw new ApiError(404, "That player is not registered", "not_found");
  await db.delete(eventPlayers).where(eq(eventPlayers.id, row.id));
  await bumpRevision(id);
  return json({ ok: true });
});
