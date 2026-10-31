/**
 * GolfCourseAPI.com adapter (free tier: 10 requests/minute, no card needed).
 * Docs: https://golfcourseapi.com  ->  GET /v1/search?search_query=...  and
 * GET /v1/getCourse/{id} with header `Authorization: Key <API_KEY>`.
 *
 * When GOLF_COURSE_API_KEY is not configured we fall back to the bundled
 * catalogue so the app is fully usable offline / in a demo.
 */
import { CATALOGUE, type CatalogueCourse } from "./catalogue";

const BASE = process.env.GOLF_COURSE_API_URL ?? "https://api.golfcourseapi.com/v1";

export type NormalisedHole = { holeNumber: number; par: number; strokeIndex: number; yards?: number };
export type NormalisedCourse = {
  externalId: string;
  name: string;
  club: string;
  address?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  par: number;
  holes: NormalisedHole[];
  tees: { name: string; colour: string; slope: number; rating: number; par: number; yardage?: number }[];
  source: "GOLFCOURSEAPI" | "CATALOGUE";
};

export function isCourseApiConfigured(): boolean {
  return Boolean(process.env.GOLF_COURSE_API_KEY);
}

function catalogueToNormalised(course: CatalogueCourse, index: number): NormalisedCourse {
  return {
    externalId: `catalogue-${index}`,
    name: course.name,
    club: course.club,
    address: course.address,
    city: course.city,
    country: course.country,
    latitude: course.latitude,
    longitude: course.longitude,
    par: course.par,
    holes: course.pars.map((par, i) => ({ holeNumber: i + 1, par, strokeIndex: course.strokeIndexes[i] })),
    tees: course.tees,
    source: "CATALOGUE",
  };
}

export function searchCatalogue(query: string): NormalisedCourse[] {
  const q = query.trim().toLowerCase();
  return CATALOGUE.map(catalogueToNormalised).filter((c) =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.club.toLowerCase().includes(q) ||
    (c.city ?? "").toLowerCase().includes(q) ||
    (c.country ?? "").toLowerCase().includes(q),
  );
}

async function apiFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Key ${process.env.GOLF_COURSE_API_KEY}`,
      Accept: "application/json",
    },
    // free tier is rate limited; cache for a day
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`GolfCourseAPI ${res.status}: ${await res.text()}`);
  return res.json();
}

function normaliseApiCourse(raw: any, id: string): NormalisedCourse {
  const male = raw?.tees?.male ?? raw?.tees?.female?.[0] ?? null;
  const holes: NormalisedHole[] = (male?.holes ?? []).map((h: any) => ({
    holeNumber: h.hole,
    par: h.par,
    strokeIndex: h.handicap ?? h.stroke_index ?? 0,
    yards: h.yardage,
  }));
  const tees = (["male", "female"] as const).flatMap((gender) =>
    ((raw?.tees?.[gender] ?? []) as any[]).map((t) => ({
      name: t.tee_name ?? (gender === "female" ? "Red" : "White"),
      colour: (t.tee_name ?? "white").toLowerCase(),
      slope: t.slope_rating ?? 113,
      rating: t.course_rating ?? 72,
      par: holes.reduce((s, h) => s + h.par, 0) || 72,
      yardage: t.total_yards,
    })),
  );
  return {
    externalId: String(raw?.id ?? id),
    name: raw?.course_name ?? "Unknown course",
    club: raw?.club_name ?? "",
    address: raw?.location?.address,
    city: raw?.location?.city,
    country: raw?.location?.country,
    latitude: raw?.location?.latitude,
    longitude: raw?.location?.longitude,
    par: holes.reduce((s, h) => s + h.par, 0) || 72,
    holes,
    tees: tees.length ? tees : [{ name: "White", colour: "white", slope: 113, rating: 72, par: 72 }],
    source: "GOLFCOURSEAPI",
  };
}

export async function searchCourses(query: string): Promise<NormalisedCourse[]> {
  const fallback = searchCatalogue(query);
  if (!isCourseApiConfigured()) return fallback;
  try {
    const data = await apiFetch(`/search?search_query=${encodeURIComponent(query)}`);
    const results: NormalisedCourse[] = (data?.courses ?? []).map((c: any) =>
      normaliseApiCourse(c, c.id),
    );
    return [...results, ...fallback];
  } catch (err) {
    console.warn("[courseApi] search failed, using catalogue", err);
    return fallback;
  }
}

export async function fetchCourse(id: string): Promise<NormalisedCourse | null> {
  if (id.startsWith("catalogue-")) {
    const idx = Number(id.replace("catalogue-", ""));
    const course = CATALOGUE[idx];
    return course ? catalogueToNormalised(course, idx) : null;
  }
  if (!isCourseApiConfigured()) return null;
  try {
    const data = await apiFetch(`/getCourse/${encodeURIComponent(id)}`);
    const raw = data?.course ?? data;
    return normaliseApiCourse(raw, id);
  } catch (err) {
    console.warn("[courseApi] fetch failed", err);
    return null;
  }
}
