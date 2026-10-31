import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { courseHoles, courses } from "@/db/schema";
import { newId } from "./ids";

export type CourseHoleInput = { holeNumber: number; par: number; strokeIndex: number; yards?: number };

export type NewCourseInput = {
  name: string;
  club?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  tees?: unknown;
  holes: CourseHoleInput[];
  externalId?: string | null;
  source?: "MANUAL" | "CATALOGUE" | "GOLFCOURSEAPI" | "IMPORT";
};

export type SaveCourseResult = { courseId: string; created: boolean };

/**
 * Writes a course and its card into the shared library.
 *
 * Idempotent on purpose: the library is shared by every club on the instance, so
 * re-importing a provider course or two organisers typing in the same club must
 * not produce a second copy. Matching is by provider id when there is one, and
 * otherwise by name + club.
 */
export async function saveCourse(input: NewCourseInput, createdBy: string): Promise<SaveCourseResult> {
  const name = input.name.trim();
  if (!name) throw new Error("A course needs a name");
  if (input.holes.length === 0) throw new Error("A course needs at least one hole");

  const club = input.club?.trim() || null;

  if (input.externalId) {
    const [existing] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.externalId, input.externalId))
      .limit(1);
    if (existing) return { courseId: existing.id, created: false };
  }

  const [sameName] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        sql`lower(${courses.name}) = ${name.toLowerCase()}`,
        club ? sql`lower(coalesce(${courses.club}, '')) = ${club.toLowerCase()}` : sql`${courses.club} is null`,
      ),
    )
    .limit(1);
  if (sameName) return { courseId: sameName.id, created: false };

  const courseId = newId();
  const parTotal = input.holes.reduce((sum, h) => sum + h.par, 0);

  await db.insert(courses).values({
    id: courseId,
    name,
    club,
    address: input.address ?? null,
    city: input.city ?? null,
    country: input.country ?? "England",
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    holesCount: input.holes.length,
    parTotal,
    tees: JSON.stringify(
      input.tees ?? [{ name: "White", colour: "white", slope: 113, rating: 72, par: parTotal }],
    ),
    source: input.source ?? "MANUAL",
    externalId: input.externalId ?? null,
    createdBy,
  });

  await db.insert(courseHoles).values(
    input.holes.map((h) => ({
      id: newId(),
      courseId,
      holeNumber: h.holeNumber,
      par: h.par,
      strokeIndex: h.strokeIndex,
      // Provider courses carry per-hole yardage; hand-built cards do not.
      yardages: h.yards ? JSON.stringify([{ tee: "White", yards: h.yards }]) : "[]",
    })),
  );

  return { courseId, created: true };
}
