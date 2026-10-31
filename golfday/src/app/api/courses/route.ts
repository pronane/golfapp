import { asc, like, or } from "drizzle-orm";
import { db } from "@/db/client";
import { courseHoles, courses } from "@/db/schema";
import { requireUser } from "@/lib/http";
import { json, parseJson, route } from "@/lib/http";
import { newId } from "@/lib/ids";
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

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = validate(createCourseSchema, await parseJson(request));
  const courseId = newId();
  const parTotal = body.holes.reduce((sum, h) => sum + h.par, 0);

  await db.insert(courses).values({
    id: courseId,
    name: body.name.trim(),
    club: body.club ?? null,
    address: body.address ?? null,
    city: body.city ?? null,
    country: body.country ?? "England",
    holesCount: body.holes.length,
    parTotal,
    tees: JSON.stringify(body.tees ?? [{ name: "White", colour: "white", slope: 113, rating: 72, par: parTotal }]),
    source: body.source ?? "MANUAL",
    externalId: body.externalId ?? null,
    createdBy: user.id,
  });

  await db.insert(courseHoles).values(
    body.holes.map((h) => ({
      id: newId(),
      courseId,
      holeNumber: h.holeNumber,
      par: h.par,
      strokeIndex: h.strokeIndex,
      yardages: "[]",
    })),
  );

  return json({ courseId }, { status: 201 });
});
