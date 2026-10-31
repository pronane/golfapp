import { json, route } from "@/lib/http";
import { getCourseWithHoles } from "@/lib/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const course = await getCourseWithHoles(id);
  if (!course) return json({ error: "Course not found" }, { status: 404 });
  return json({
    course: course.course,
    holes: course.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex })),
  });
});
