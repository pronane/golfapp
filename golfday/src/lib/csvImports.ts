import { parseCsv } from "./golfengland";

type Field = "courseName" | "club" | "city" | "country" | "teeName" | "slope" | "rating" | "holeNumber" | "par" | "strokeIndex" | "yards";
type EventField = "name" | "description" | "date" | "startTime" | "courseName" | "format" | "handicapAllowance" | "maxPlayers" | "isPublic";

export type ImportedCourse = {
  name: string;
  club: string | null;
  city: string | null;
  country: string | null;
  teeName: string;
  slope: number;
  rating: number;
  holes: { holeNumber: number; par: number; strokeIndex: number; yards?: number }[];
};

export type ImportedEvent = {
  name: string;
  description?: string;
  date: string;
  startTime: string;
  courseName?: string;
  format: "STABLEFORD" | "STROKE_PLAY" | "TEXAS_SCRAMBLE";
  handicapAllowance: number;
  maxPlayers: number;
  isPublic: boolean;
};

function headerName(value: string): string {
  return value.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function columns<T extends string>(table: string[][], aliases: Record<string, T>): (T | null)[] {
  return table[0].map((cell) => aliases[headerName(cell)] ?? null);
}

const COURSE_HEADERS: Record<string, Field> = {
  coursename: "courseName", course: "courseName", venue: "courseName",
  club: "club", clubname: "club", homeclub: "club",
  city: "city", town: "city", country: "country",
  tee: "teeName", teename: "teeName", teecolour: "teeName", teecolor: "teeName",
  slope: "slope", sloperating: "slope",
  rating: "rating", courserating: "rating", teerating: "rating",
  hole: "holeNumber", holenumber: "holeNumber", holeno: "holeNumber",
  par: "par",
  si: "strokeIndex", strokeindex: "strokeIndex", strokeindexnumber: "strokeIndex",
  yards: "yards", yardage: "yards", distance: "yards",
};

const EVENT_HEADERS: Record<string, EventField> = {
  name: "name", event: "name", eventname: "name", competition: "name", tournament: "name", outing: "name",
  description: "description", notes: "description",
  date: "date", eventdate: "date", competitiondate: "date",
  starttime: "startTime", teetime: "startTime", firsttee: "startTime",
  course: "courseName", coursename: "courseName", venue: "courseName",
  format: "format", eventformat: "format", competitionformat: "format",
  handicapallowance: "handicapAllowance", allowance: "handicapAllowance", allowancepercent: "handicapAllowance",
  maxplayers: "maxPlayers", fieldsize: "maxPlayers", players: "maxPlayers",
  ispublic: "isPublic", visibility: "isPublic",
};

export function parseCourseCsv(text: string): { courses: ImportedCourse[]; errors: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { courses: [], errors: ["The file is empty"] };
  const header = columns(table, COURSE_HEADERS);
  const errors: string[] = [];
  for (const required of ["courseName", "holeNumber", "par", "strokeIndex"] as const) {
    if (!header.includes(required)) {
      return { courses: [], errors: [`Could not find a '${required}' column in the course CSV`] };
    }
  }

  const grouped = new Map<string, { course: ImportedCourse; invalid: boolean; seen: Set<number> }>();
  table.slice(1).forEach((cells, rowIndex) => {
    const values: Partial<Record<Field, string>> = {};
    cells.forEach((cell, index) => {
      const field = header[index];
      if (field) values[field] = cell.trim();
    });
    const name = values.courseName?.trim();
    if (!name) {
      errors.push(`Row ${rowIndex + 2}: missing course name - row skipped`);
      return;
    }
    const numeric = (field: Field, fallback?: number): number | undefined => {
      const raw = values[field];
      if (!raw) return fallback;
      const result = Number(raw.replace(",", "."));
      return Number.isFinite(result) ? result : undefined;
    };
    const holeNumber = numeric("holeNumber");
    const par = numeric("par");
    const strokeIndex = numeric("strokeIndex");
    const slope = numeric("slope", 113);
    const rating = numeric("rating", 72);
    const yards = values.yards ? numeric("yards") : undefined;
    if (
      holeNumber == null || !Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18 ||
      par == null || !Number.isInteger(par) || par < 3 || par > 6 ||
      strokeIndex == null || !Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > 18 ||
      slope == null || slope < 55 || slope > 155 ||
      rating == null || rating < 55 || rating > 80 ||
      (values.yards && (yards == null || !Number.isInteger(yards) || yards < 1000 || yards > 9000))
    ) {
      errors.push(`Row ${rowIndex + 2}: invalid hole, par, stroke index, tee rating, or yardage - row skipped`);
      return;
    }

    const club = values.club?.trim() || null;
    const key = `${name.toLowerCase()}\u0000${club?.toLowerCase() ?? ""}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        course: {
          name,
          club,
          city: values.city?.trim() || null,
          country: values.country?.trim() || null,
          teeName: values.teeName?.trim() || "White",
          slope,
          rating,
          holes: [],
        },
        invalid: false,
        seen: new Set<number>(),
      };
      grouped.set(key, group);
    }
    if (
      group.course.teeName !== (values.teeName?.trim() || "White") ||
      group.course.slope !== slope ||
      group.course.rating !== rating
    ) {
      errors.push(`Row ${rowIndex + 2}: a course CSV must use one tee and tee rating per course`);
      group.invalid = true;
      return;
    }
    if (group.seen.has(holeNumber)) {
      errors.push(`Row ${rowIndex + 2}: duplicate hole ${holeNumber} for ${name}`);
      group.invalid = true;
      return;
    }
    group.seen.add(holeNumber);
    group.course.holes.push({
      holeNumber,
      par,
      strokeIndex,
      ...(yards == null ? {} : { yards }),
    });
  });

  const courses: ImportedCourse[] = [];
  for (const { course, invalid, seen } of grouped.values()) {
    const validCard =
      !invalid &&
      course.holes.length === 18 &&
      new Set(course.holes.map((hole) => hole.strokeIndex)).size === 18 &&
      Array.from({ length: 18 }, (_, index) => seen.has(index + 1)).every(Boolean);
    if (!validCard) {
      errors.push(`${course.name}: expected one complete 18-hole card with unique stroke indexes`);
      continue;
    }
    course.holes.sort((a, b) => a.holeNumber - b.holeNumber);
    courses.push(course);
  }
  return { courses, errors };
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : uk
      ? [Number(uk[3]), Number(uk[2]), Number(uk[1])]
      : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseEventFormat(value: string): ImportedEvent["format"] | null {
  const format = value.toLowerCase().replace(/[^a-z]/g, "");
  if (format === "stableford" || format === "points") return "STABLEFORD";
  if (format === "strokeplay" || format === "medal" || format === "netstrokeplay") return "STROKE_PLAY";
  if (format === "texasscramble" || format === "scramble") return "TEXAS_SCRAMBLE";
  return null;
}

export function parseEventCsv(text: string): { events: ImportedEvent[]; errors: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { events: [], errors: ["The file is empty"] };
  const header = columns(table, EVENT_HEADERS);
  const errors: string[] = [];
  for (const required of ["name", "date", "format"] as const) {
    if (!header.includes(required)) return { events: [], errors: [`Could not find a '${required}' column in the event CSV`] };
  }
  const events: ImportedEvent[] = [];
  table.slice(1).forEach((cells, rowIndex) => {
    const values: Partial<Record<EventField, string>> = {};
    cells.forEach((cell, index) => {
      const field = header[index];
      if (field) values[field] = cell.trim();
    });
    const name = values.name?.trim();
    const date = values.date ? parseDate(values.date) : null;
    const format = values.format ? parseEventFormat(values.format) : null;
    const startTime = values.startTime?.trim() || "08:00";
    const allowance = values.handicapAllowance ? Number(values.handicapAllowance.replace("%", "")) : 95;
    const maxPlayers = values.maxPlayers ? Number(values.maxPlayers) : 72;
    if (!name || name.length < 2 || !date || !format || !/^\d{2}:\d{2}$/.test(startTime)) {
      errors.push(`Row ${rowIndex + 2}: invalid name, date, format, or start time - row skipped`);
      return;
    }
    if (!Number.isInteger(allowance) || allowance < 0 || allowance > 100 || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 200) {
      errors.push(`Row ${rowIndex + 2}: invalid handicap allowance or field size - row skipped`);
      return;
    }
    const publicValue = (values.isPublic ?? "").toLowerCase();
    events.push({
      name,
      ...(values.description ? { description: values.description } : {}),
      date,
      startTime,
      ...(values.courseName ? { courseName: values.courseName } : {}),
      format,
      handicapAllowance: allowance,
      maxPlayers,
      isPublic: !["false", "0", "no", "private"].includes(publicValue),
    });
  });
  return { events, errors };
}
