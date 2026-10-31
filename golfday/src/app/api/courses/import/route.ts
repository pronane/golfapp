import { db } from "@/db/client";
import { courseHoles, courses } from "@/db/schema";
import { requireUser } from "@/lib/http";
import { ApiError, json, parseJson, route } from "@/lib/http";
import { fetchCourse } from "@/lib/courseApi";
import { newId } from "@/lib/ids";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({ externalId: z.string().min(1) });

/** Saves a course from the external provider into our own catalogue. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const { externalId } = validate(schema, await parseJson(request));
  const course = await fetchCourse(externalId);
  if (!course) throw new ApiError(404, "That course could not be loaded from the provider", "not_found");
  if (course.holes.length < 9) throw new ApiError(422, "That course does not have a full scorecard", "incomplete_card");

  const id = newId();
  await db.insert(courses).values({
    id,
    name: course.name,
    club: course.club,
    address: course.address ?? null,
    city: course.city ?? null,
    country: course.country ?? "England",
    latitude: course.latitude ?? null,
    longitude: course.longitude ?? null,
    holesCount: course.holes.length,
    parTotal: course.holes.reduce((sum, h) => sum + h.par, 0),
    tees: JSON.stringify(course.tees),
    source: course.source,
    externalId: course.externalId,
    createdBy: user.id,
  });
  await db.insert(courseHoles).values(
    course.holes.map((h) => ({
      id: newId(),
      courseId: id,
      holeNumber: h.holeNumber,
      par: h.par,
      strokeIndex: h.strokeIndex,
      yardages: h.yards ? JSON.stringify([{ tee: "White", yards: h.yards }]) : "[]",
    })),
  );
  return json({ courseId: id }, { status: 201 });
});
