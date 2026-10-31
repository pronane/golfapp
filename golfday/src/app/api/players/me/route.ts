import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { lookupByGolfEnglandId } from "@/lib/golfengland";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({
  name: z.string().min(2).max(80).optional(),
  handicapIndex: z.coerce.number().min(-10).max(54).optional(),
  homeClub: z.string().max(120).optional(),
  golfEnglandId: z.string().max(30).optional(),
  refreshFromGolfEngland: z.boolean().optional(),
});

/** Update the signed-in user's own player profile / pull a fresh handicap. */
export const PATCH = route(async (request: Request) => {
  const user = await requireUser();
  if (!user.playerId) throw new ApiError(409, "Your account has no player profile yet", "no_player");
  const body = validate(schema, await parseJson(request));
  const [player] = await db.select().from(players).where(eq(players.id, user.playerId)).limit(1);
  if (!player) throw new ApiError(404, "Player not found", "not_found");

  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.homeClub !== undefined) updates.homeClub = body.homeClub;
  if (body.golfEnglandId !== undefined) updates.golfEnglandId = body.golfEnglandId || null;
  if (body.handicapIndex !== undefined) {
    updates.handicapIndex = body.handicapIndex;
    updates.handicapSource = "MANUAL";
    updates.handicapUpdatedAt = new Date().toISOString();
  }

  if (body.refreshFromGolfEngland) {
    const id = body.golfEnglandId ?? player.golfEnglandId;
    if (!id) throw new ApiError(400, "Add your Golf England ID first", "missing_id");
    const found = await lookupByGolfEnglandId(id);
    if (!found) throw new ApiError(404, "No golfer found for that Golf England ID", "not_found");
    updates.handicapIndex = found.handicapIndex;
    updates.homeClub = found.homeClub || player.homeClub;
    updates.golfEnglandId = found.golfEnglandId;
    updates.handicapSource = found.source;
    updates.handicapUpdatedAt = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) return json({ ok: true, player });
  await db.update(players).set(updates).where(eq(players.id, player.id));
  const [updatedPlayer] = await db.select().from(players).where(eq(players.id, player.id)).limit(1);
  return json({ ok: true, player: updatedPlayer });
});
