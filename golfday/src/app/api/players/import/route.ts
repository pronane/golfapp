import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { newClaimCode, newId } from "@/lib/ids";
import { parsePlayerCsv } from "@/lib/golfengland";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({
  csv: z.string().min(5, "Paste a CSV first"),
  eventId: z.string().optional(),
});

/** Bulk-add players from a Golf England / club handicap CSV export. */
export const POST = route(async (request: Request) => {
  await requireUser();
  const { csv, eventId } = validate(schema, await parseJson(request));
  const { rows, errors } = parsePlayerCsv(csv);
  if (rows.length === 0) throw new ApiError(422, errors[0] ?? "No players found in that file", "validation_error");

  let created = 0;
  let updated = 0;
  let registered = 0;
  const skipped: string[] = [];
  const touched: string[] = [];
  for (const row of rows) {
    const existing = row.golfEnglandId
      ? (await db.select().from(players).where(eq(players.golfEnglandId, row.golfEnglandId)).limit(1))[0]
      : undefined;
    if (existing) {
      await db
        .update(players)
        .set({
          name: row.name,
          handicapIndex: row.handicapIndex,
          homeClub: row.homeClub ?? existing.homeClub,
          handicapSource: "CSV",
          handicapUpdatedAt: new Date().toISOString(),
        })
        .where(eq(players.id, existing.id));
      updated++;
      touched.push(existing.id);
    } else {
      const newPlayerId = newId();
      await db.insert(players).values({
        id: newPlayerId,
        name: row.name,
        email: row.email || null,
        handicapIndex: row.handicapIndex,
        golfEnglandId: row.golfEnglandId || null,
        homeClub: row.homeClub || null,
        gender: row.gender ?? null,
        claimCode: newClaimCode(),
        handicapSource: "CSV",
        handicapUpdatedAt: new Date().toISOString(),
      });
      created++;
      touched.push(newPlayerId);
    }
  }

  // optionally put everyone straight into the event
  if (eventId) {
    const { registerPlayer } = await import("@/lib/events");
    for (const playerId of touched) {
      try {
        await registerPlayer({ eventId, playerId });
        registered++;
      } catch (err) {
        skipped.push(err instanceof Error ? err.message : "could not register");
      }
    }
  }

  return json({ created, updated, registered, skipped, errors, total: rows.length }, { status: 201 });
});
