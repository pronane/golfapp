import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { json, parseJson, requireUser, route } from "@/lib/http";
import { createEvent, listEventsForAdmin, listEventsForPlayer, listPublicEvents } from "@/lib/events";
import { createEventSchema, validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const scope = new URL(request.url).searchParams.get("scope") ?? "public";
  const user = await getCurrentUser();
  if (scope === "public") {
    const rows = await listPublicEvents();
    return json({ events: rows });
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
  return json({ events: rows });
});

/** Anyone signed in can create an event - they become its owner/admin. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = validate(createEventSchema, await parseJson(request));
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
    createdBy: user.id,
  });
  return json({ event: created }, { status: 201 });
});
