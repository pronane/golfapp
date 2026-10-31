import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { AdminCourses } from "@/components/AdminCourses";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/courses");
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
