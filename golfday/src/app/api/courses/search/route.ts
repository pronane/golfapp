import { requireUser } from "@/lib/http";
import { json, route } from "@/lib/http";
import { isCourseApiConfigured, searchCourses } from "@/lib/courseApi";

export const dynamic = "force-dynamic";

/** Searches GolfCourseAPI (when a free key is configured) plus the local catalogue. */
export const GET = route(async (request: Request) => {
  await requireUser();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const results = await searchCourses(q);
  return json({ configured: isCourseApiConfigured(), courses: results });
});
