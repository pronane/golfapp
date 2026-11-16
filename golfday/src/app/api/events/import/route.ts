import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { courses } from "@/db/schema";
import { createEvent } from "@/lib/events";
import { parseEventCsv } from "@/lib/csvImports";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({ csv: z.string().min(5).max(2_000_000) });

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const { csv } = validate(schema, await parseJson(request));
  const { events: rows, errors } = parseEventCsv(csv);
  if (rows.length === 0) throw new ApiError(422, errors[0] ?? "No events found in that file", "validation_error", errors);
  const courseRows = await db.select().from(courses).orderBy(asc(courses.name));
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const imported: { eventId: string; name: string; date: string }[] = [];
  for (const row of rows) {
    const course = row.courseName
      ? courseRows.find((candidate) =>
          normalise(candidate.name) === normalise(row.courseName!) ||
          normalise([candidate.name, candidate.club].filter(Boolean).join(", ")) === normalise(row.courseName!))
      : undefined;
    if (row.courseName && !course) {
      errors.push(`${row.name}: course "${row.courseName}" was not found in the course library; event skipped`);
      continue;
    }
    const created = await createEvent({
      name: row.name,
      description: row.description,
      date: row.date,
      startTime: row.startTime,
      courseId: course?.id ?? null,
      format: row.format,
      handicapAllowance: row.handicapAllowance,
      maxPlayers: row.maxPlayers,
      isPublic: row.isPublic,
      status: "DRAFT",
      createdBy: user.id,
    });
    imported.push({ eventId: created.id, name: row.name, date: row.date });
  }
  if (imported.length === 0) throw new ApiError(422, errors[0] ?? "No events could be imported", "validation_error", errors);
  return json({ imported, errors }, { status: 201 });
});
