import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { ApiError, getEventAccess, json, parseJson, requireUser, route } from "@/lib/http";
import { getEventById, registerPlayer } from "@/lib/events";
import { parsePlayerList } from "@/lib/fieldImport";
import { newClaimCode, newId } from "@/lib/ids";
import { z } from "zod";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** The pasted list: one player per line, handicap and club optional. */
  text: z.string().min(2, "Paste some names first"),
});

/**
 * Turn a pasted list of names into the field, in one request.
 *
 * This is the organiser's shortcut: they copy "Dave Smith 12.4" out of a
 * WhatsApp message and press one button. Each name is matched to an existing
 * player first (so a regular is never duplicated), and only a genuinely new name
 * creates a guest player - no account needed, claimable later with the claim
 * code. Everything then goes through `registerPlayer`, so capacity, the
 * one-event-a-day rule and the handicap maths are the same as the slow path.
 *
 * What came back is reported line by line: who was added, who was new, who was
 * skipped and why. Nothing is silently dropped.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await getEventAccess(id, user);
  if (!access?.isAdmin) throw new ApiError(403, "Only event admins can add players", "forbidden");

  const event = await getEventById(id);
  if (!event) throw new ApiError(404, "Event not found", "not_found");

  const { text } = validate(schema, await parseJson(request));
  const { players: entries, problems } = parsePlayerList(text);
  if (entries.length === 0) {
    throw new ApiError(422, problems[0] ? `Nothing to add: ${problems[0].reason} (line ${problems[0].lineNumber})` : "No players found in that list", "validation_error");
  }

  const added: { playerId: string; name: string; handicap: number; created: boolean }[] = [];
  const skipped: { name: string; reason: string }[] = [...problems.map((p) => ({ name: p.line, reason: `${p.reason} (line ${p.lineNumber})` }))];

  for (const entry of entries) {
    // Match on the name, case-insensitively, so a regular is reused rather than
    // duplicated. Two players with the same name already in the directory is
    // ambiguous, so the first is used and the result says which one.
    const [existing] = await db
      .select()
      .from(players)
      .where(sql`lower(${players.name}) = ${entry.name.toLowerCase()}`)
      .limit(1);

    let playerId = existing?.id;
    let handicap = existing?.handicapIndex ?? entry.handicap ?? 0;
    let created = false;

    if (!playerId) {
      playerId = newId();
      await db.insert(players).values({
        id: playerId,
        name: entry.name,
        // No number given means scratch, not "nobody checked" - the organiser can
        // correct it on the field tab afterwards.
        handicapIndex: entry.handicap ?? 0,
        homeClub: entry.club || null,
        claimCode: newClaimCode(),
        handicapSource: entry.handicap === null ? "NONE" : "MANUAL",
        handicapVerified: false,
        handicapUpdatedAt: new Date().toISOString(),
      });
      handicap = entry.handicap ?? 0;
      created = true;
    } else if (entry.handicap !== null && entry.handicap !== existing.handicapIndex) {
      // The organiser typed a handicap that differs from the stored one: trust
      // the list they are holding on the day, and record where it came from.
      await db
        .update(players)
        .set({ handicapIndex: entry.handicap, handicapSource: "MANUAL", handicapUpdatedAt: new Date().toISOString() })
        .where(eq(players.id, playerId));
      handicap = entry.handicap;
    }

    try {
      await registerPlayer({ eventId: id, playerId, force: true });
      added.push({ playerId, name: entry.name, handicap, created });
    } catch (err) {
      skipped.push({ name: entry.name, reason: err instanceof Error ? err.message : "could not be added" });
    }
  }

  return json(
    {
      added,
      skipped,
      created: added.filter((a) => a.created).length,
      entered: added.length,
    },
    { status: 201 },
  );
});
