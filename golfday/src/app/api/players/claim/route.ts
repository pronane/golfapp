import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { requireUser } from "@/lib/http";
import { ApiError, json, parseJson, route } from "@/lib/http";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({ claimCode: z.string().min(4).max(12) });

/** Link a guest player record (created by an event admin) to the signed-in user. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const { claimCode } = validate(schema, await parseJson(request));
  const [player] = await db
    .select()
    .from(players)
    .where(eq(players.claimCode, claimCode.trim().toUpperCase()))
    .limit(1);
  if (!player) throw new ApiError(404, "That claim code does not exist", "not_found");
  if (player.userId) throw new ApiError(409, "That player profile is already linked to an account", "already_claimed");

  const [existing] = await db.select().from(players).where(eq(players.userId, user.id)).limit(1);
  if (existing) throw new ApiError(409, "Your account already has a player profile", "already_has_player");

  await db.update(players).set({ userId: user.id, email: user.email }).where(eq(players.id, player.id));
  return json({ ok: true, playerId: player.id });
});
