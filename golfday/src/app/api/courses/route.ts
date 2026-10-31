import { asc, like, or } from "drizzle-orm";
import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { requireOrganiser, requireUser } from "@/lib/http";
import { json, parseJson, route } from "@/lib/http";
import { saveCourse } from "@/lib/courses";
import { createCourseSchema, validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  await requireUser();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const rows = await db
    .select()
    .from(courses)
    .where(q ? or(like(courses.name, `%${q}%`), like(courses.club, `%${q}%`), like(courses.city, `%${q}%`)) : undefined)
    .orderBy(asc(courses.club))
    .limit(50);
  return json({ courses: rows });
});

/**
 * Add a course to the shared library by hand.
 *
 * Organisers only (see `requireOrganiser`). First-time organisers do not need
 * this endpoint: creating a golf day can carry its course with it, and that
 * makes the creator the event's owner.
 */
export const POST = route(async (request: Request) => {
  const user = await requireOrganiser();
  const body = validate(createCourseSchema, await parseJson(request));
  const { courseId, created } = await saveCourse(
    {
      name: body.name,
      club: body.club,
      address: body.address,
      city: body.city,
      country: body.country,
      tees: body.tees,
      holes: body.holes,
      externalId: body.externalId,
      source: body.source ?? "MANUAL",
    },
    user.id,
  );
  // 200 when the card was already in the library, 201 when this call added it.
  return json({ courseId, created }, { status: created ? 201 : 200 });
});
