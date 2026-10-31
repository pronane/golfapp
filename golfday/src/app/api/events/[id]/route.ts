import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventHoles, events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, getCourseWithHoles, getEventBundle, recalculateHandicaps } from "@/lib/events";
import { newId } from "@/lib/ids";
import { updateEventSchema, validate } from "@/lib/validate";
import { deleteEventGames } from "@/lib/games";
import { deleteEventPayments } from "@/lib/payments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await getEventAccess(id, user);
  const bundle = await getEventBundle(id);
  if (!bundle) throw new ApiError(404, "Event not found", "not_found");
  if (!bundle.event.isPublic && !access) throw new ApiError(403, "This event is private", "forbidden");

  const isRegistered = Boolean(
    user?.playerId && bundle.registrations.some((r) => r.player.id === user.playerId),
  );
  return json({
    event: bundle.event,
    holes: bundle.holes,
    groups: bundle.groups,
    registrations: bundle.registrations.map((r) => ({
      player: r.player,
      registration: r.registration,
    })),
    admins: access?.isAdmin ? bundle.admins : undefined,
    access: access ? { role: access.role, isAdmin: access.isAdmin } : null,
    isRegistered,
    revision: bundle.revision,
  });
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can edit the event", "forbidden");
  const body = validate(updateEventSchema, await parseJson(request));

  const updates: Record<string, unknown> = {};
  for (const key of ["name", "description", "date", "startTime", "format", "handicapAllowance", "maxPlayers", "status", "isPublic", "allowCourseClash"] as const) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.courseId !== undefined && body.courseId !== access.event.courseId) {
    updates.courseId = body.courseId;
    if (body.courseId) {
      const course = await getCourseWithHoles(body.courseId);
      if (!course) throw new ApiError(404, "Course not found", "course_not_found");
      updates.courseName = [course.course.name, course.course.club].filter(Boolean).join(", ");
      if (course.holes.length > 0) {
        await db.delete(eventHoles).where(eq(eventHoles.eventId, id));
        await db.insert(eventHoles).values(
          course.holes.map((h) => ({
            id: newId(),
            eventId: id,
            holeNumber: h.holeNumber,
            par: h.par,
            strokeIndex: h.strokeIndex,
          })),
        );
      }
    } else {
      updates.courseName = null;
    }
  }
  if (Object.keys(updates).length > 0) {
    await db.update(events).set(updates).where(eq(events.id, id));
  }
  if (body.handicapAllowance !== undefined) await recalculateHandicaps(id);
  await bumpRevision(id);
  return json({ ok: true });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (access.role !== "OWNER" && !user.isSiteAdmin) {
    throw new ApiError(403, "Only the event owner can delete the event", "forbidden");
  }
  await db.delete(events).where(eq(events.id, id));
  await deleteEventGames(id);
  await deleteEventPayments(id);
  return json({ ok: true });
});
