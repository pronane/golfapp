import { requireOrganiser } from "@/lib/http";
import { ApiError, json, parseJson, route } from "@/lib/http";
import { fetchCourse } from "@/lib/courseApi";
import { saveCourse } from "@/lib/courses";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({ externalId: z.string().min(1) });

/**
 * Copies a course from the external provider into our own catalogue.
 *
 * Organisers only, and idempotent: importing the same provider course twice
 * returns the row that is already there rather than a duplicate.
 */
export const POST = route(async (request: Request) => {
  const user = await requireOrganiser();
  const { externalId } = validate(schema, await parseJson(request));
  const course = await fetchCourse(externalId);
  if (!course) throw new ApiError(404, "That course could not be loaded from the provider", "not_found");
  if (course.holes.length < 9) throw new ApiError(422, "That course does not have a full scorecard", "incomplete_card");

  const { courseId, created } = await saveCourse(
    {
      name: course.name,
      club: course.club,
      address: course.address ?? null,
      city: course.city ?? null,
      country: course.country ?? "England",
      latitude: course.latitude ?? null,
      longitude: course.longitude ?? null,
      tees: course.tees,
      holes: course.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex, yards: h.yards })),
      externalId: course.externalId,
      source: course.source,
    },
    user.id,
  );
  return json({ courseId, created }, { status: created ? 201 : 200 });
});
