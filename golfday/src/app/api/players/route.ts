import { asc, like, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { requireUser } from "@/lib/http";
import { json, parseJson, route } from "@/lib/http";
import { newClaimCode, newId } from "@/lib/ids";
import { createPlayerSchema, validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  await requireUser();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const rows = await db
    .select({
      id: players.id,
      name: players.name,
      handicapIndex: players.handicapIndex,
      homeClub: players.homeClub,
      golfEnglandId: players.golfEnglandId,
      // email intentionally omitted: any signed-in user can search this
      // directory, so returning it let anyone harvest every golfer's address.
      hasAccount: sql<boolean>`${players.userId} is not null`,
    })
    .from(players)
    .where(q ? or(like(players.name, `%${q}%`), like(players.homeClub, `%${q}%`), like(players.golfEnglandId, `%${q}%`)) : undefined)
    .orderBy(asc(players.name))
    .limit(25);
  return json({ players: rows });
});

export const POST = route(async (request: Request) => {
  await requireUser();
  const body = validate(createPlayerSchema, await parseJson(request));
  const [row] = await db
    .insert(players)
    .values({
      id: newId(),
      name: body.name.trim(),
      email: body.email || null,
      handicapIndex: body.handicapIndex,
      golfEnglandId: body.golfEnglandId || null,
      homeClub: body.homeClub || null,
      gender: body.gender ?? null,
      claimCode: newClaimCode(),
      handicapSource: body.golfEnglandId ? "GOLF_ENGLAND" : "MANUAL",
      handicapUpdatedAt: new Date().toISOString(),
    })
    .returning();
  return json({ player: row }, { status: 201 });
});
