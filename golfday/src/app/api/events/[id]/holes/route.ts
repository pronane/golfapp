import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventHoles } from "@/db/schema";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, getEventHoles } from "@/lib/events";
import { newId } from "@/lib/ids";
import { z } from "zod";
import { holeSchema, validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return json({ holes: await getEventHoles(id) });
});

const schema = z.object({ holes: z.array(holeSchema).min(9).max(18) });

/** Requirement 4: the event admin can correct par / stroke index for the day. */
export const PUT = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can edit the card", "forbidden");
  const body = validate(schema, await parseJson(request));
  const unique = new Set(body.holes.map((h) => h.holeNumber));
  if (unique.size !== body.holes.length) throw new ApiError(400, "Two holes share a number", "validation_error");

  for (const hole of body.holes) {
    const [existing] = await db
      .select()
      .from(eventHoles)
      .where(and(eq(eventHoles.eventId, id), eq(eventHoles.holeNumber, hole.holeNumber)))
      .limit(1);
    if (existing) {
      await db
        .update(eventHoles)
        .set({ par: hole.par, strokeIndex: hole.strokeIndex })
        .where(eq(eventHoles.id, existing.id));
    } else {
      await db.insert(eventHoles).values({ id: newId(), eventId: id, ...hole });
    }
  }
  await bumpRevision(id);
  return json({ ok: true, holes: await getEventHoles(id) });
});
