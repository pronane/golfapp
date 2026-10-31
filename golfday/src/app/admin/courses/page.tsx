import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isOrganiser } from "@/lib/http";
import { AdminCourses } from "@/components/AdminCourses";

export const dynamic = "force-dynamic";

/**
 * The shared course library is maintained by organisers (site admins, or anyone
 * who runs a golf day). A player who has never created an event is sent back to
 * the fixture list rather than shown a builder whose save button would 403.
 */
export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/courses");
  if (!(await isOrganiser(user))) redirect("/events");
  const rows = await db.select().from(courses).orderBy(asc(courses.club), asc(courses.name));
  return (
    <AdminCourses
      courses={rows.map((c) => ({
        id: c.id,
        name: c.name,
        club: c.club,
        city: c.city,
        parTotal: c.parTotal,
        holesCount: c.holesCount,
        source: c.source,
      }))}
    />
  );
}
