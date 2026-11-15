import { saveCourse } from "@/lib/courses";
import { parseCourseCsv } from "@/lib/csvImports";
import { ApiError, json, parseJson, requireOrganiser, route } from "@/lib/http";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({ csv: z.string().min(5).max(2_000_000) });

export const POST = route(async (request: Request) => {
  const user = await requireOrganiser("import courses");
  const { csv } = validate(schema, await parseJson(request));
  const { courses, errors } = parseCourseCsv(csv);
  if (courses.length === 0) throw new ApiError(422, errors[0] ?? "No complete courses found in that file", "validation_error", errors);

  let created = 0;
  let existing = 0;
  const imported: { courseId: string; name: string }[] = [];
  for (const course of courses) {
    const saved = await saveCourse({
      name: course.name,
      club: course.club,
      city: course.city,
      country: course.country,
      tees: [{
        name: course.teeName,
        colour: course.teeName.toLowerCase(),
        slope: course.slope,
        rating: course.rating,
        par: course.holes.reduce((sum, hole) => sum + hole.par, 0),
      }],
      holes: course.holes,
      source: "IMPORT",
    }, user.id);
    if (saved.created) created++;
    else existing++;
    imported.push({ courseId: saved.courseId, name: course.name });
  }
  return json({ created, existing, imported, errors }, { status: created ? 201 : 200 });
});
