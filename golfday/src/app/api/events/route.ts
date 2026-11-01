import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { json, parseJson, requireUser, route } from "@/lib/http";
import { createEvent, listEventsForAdmin, listEventsForPlayer, listPublicEvents } from "@/lib/events";
import { requireSocietyRole } from "@/lib/societies";
import { createEventSchema, validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Strip the organiser-only bits (join code) from an event before it goes public. */
function publicEvent<T extends { joinCode: string }>(event: T): Omit<T, "joinCode"> {
  const { joinCode: _joinCode, ...rest } = event;
  return rest;
}

export const GET = route(async (request: Request) => {
  const scope = new URL(request.url).searchParams.get("scope") ?? "public";
  const user = await getCurrentUser();
  if (scope === "public") {
    // Never hand out join codes on a public endpoint: the code is the organiser's
    // to share, and publishing it would let anyone add themselves to a field.
    const rows = await listPublicEvents();
    return json({ events: rows.map(({ event, playerCount }) => ({ event: publicEvent(event), playerCount })) });
  }
  if (!user) return json({ events: [] });
  if (scope === "mine") {
    if (!user.playerId) return json({ events: [] });
    const rows = await listEventsForPlayer(user.playerId);
    return json({ events: rows });
  }
  if (scope === "admin") {
    const rows = await listEventsForAdmin(user.id);
    return json({ events: rows });
  }
  const rows = await db
    .select()
    .from(events)
    .where(and(ne(events.status, "CANCELLED"), eq(events.isPublic, true)))
    .orderBy(desc(events.date))
    .limit(50);
  return json({ events: rows.map(publicEvent) });
});

/** Anyone signed in can create an event - they become its owner/admin. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = validate(createEventSchema, await parseJson(request));
  // A golf day can only join a society the creator actually runs.
  if (body.societyId) await requireSocietyRole(user, body.societyId);
  const created = await createEvent({
    name: body.name,
    description: body.description,
    date: body.date,
    startTime: body.startTime,
    courseId: body.courseId ?? null,
    format: body.format,
    handicapAllowance: body.handicapAllowance,
    maxPlayers: body.maxPlayers,
    status: body.status,
    isPublic: body.isPublic,
    holes: body.holes,
    newCourse: body.newCourse,
    importExternalId: body.importExternalId ?? null,
    societyId: body.societyId ?? null,
    createdBy: user.id,
  });
  return json({ event: created }, { status: 201 });
});
