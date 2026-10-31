import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  courseHoles,
  courses,
  eventAdmins,
  eventHoles,
  eventPlayers,
  eventState,
  events,
  groups,
  players,
  scores,
  users,
} from "@/db/schema";
import { ApiError } from "./http";
import { saveCourse } from "./courses";
import { fetchCourse } from "./courseApi";
import { courseHandicap, DEFAULT_TEE, parseTees, playingHandicap as calcPlayingHandicap, type Tee } from "./handicap";
import { newId, newJoinCode, newToken, uniqueSlug } from "./ids";
import { type EventStatus } from "./status";

export { EVENT_STATUSES, STATUS_LABEL, STATUS_STYLE } from "./status";
export type { EventStatus } from "./status";

/** Bump the event revision so live clients know something changed. */
export async function bumpRevision(eventId: string): Promise<number> {
  const now = new Date().toISOString();
  await db
    .insert(eventState)
    .values({ eventId, revision: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: eventState.eventId,
      set: { revision: sql`${eventState.revision} + 1`, updatedAt: now },
    });
  await db.update(events).set({ updatedAt: now }).where(eq(events.id, eventId));
  const [row] = await db.select().from(eventState).where(eq(eventState.eventId, eventId)).limit(1);
  return row?.revision ?? 1;
}

export async function getRevision(eventId: string): Promise<number> {
  const [row] = await db.select().from(eventState).where(eq(eventState.eventId, eventId)).limit(1);
  return row?.revision ?? 0;
}

export async function getEventById(eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  return event ?? null;
}

export async function getEventBySlug(slug: string) {
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  return event ?? null;
}

export async function getEventByJoinCode(code: string) {
  const [event] = await db.select().from(events).where(eq(events.joinCode, code.toUpperCase())).limit(1);
  return event ?? null;
}

export async function getEventHoles(eventId: string) {
  return db
    .select()
    .from(eventHoles)
    .where(eq(eventHoles.eventId, eventId))
    .orderBy(asc(eventHoles.holeNumber));
}

export async function getEventGroups(eventId: string) {
  return db.select().from(groups).where(eq(groups.eventId, eventId)).orderBy(asc(groups.sortOrder), asc(groups.name));
}

export async function getEventRegistrations(eventId: string) {
  return db
    .select({
      registration: eventPlayers,
      player: players,
    })
    .from(eventPlayers)
    .innerJoin(players, eq(players.id, eventPlayers.playerId))
    .where(and(eq(eventPlayers.eventId, eventId), ne(eventPlayers.status, "WITHDRAWN")))
    .orderBy(asc(players.name));
}

export async function getEventAdmins(eventId: string) {
  return db
    .select({
      id: eventAdmins.id,
      userId: eventAdmins.userId,
      role: eventAdmins.role,
      name: users.name,
      email: users.email,
    })
    .from(eventAdmins)
    .innerJoin(users, eq(users.id, eventAdmins.userId))
    .where(eq(eventAdmins.eventId, eventId));
}

export async function getEventScores(eventId: string) {
  return db.select().from(scores).where(eq(scores.eventId, eventId));
}

export async function getCourseWithHoles(courseId: string) {
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) return null;
  const holes = await db
    .select()
    .from(courseHoles)
    .where(eq(courseHoles.courseId, courseId))
    .orderBy(asc(courseHoles.holeNumber));
  return { course, holes };
}

/** Full payload used by the event page, scoring page and leaderboard API. */
export async function getEventBundle(eventId: string) {
  const event = await getEventById(eventId);
  if (!event) return null;
  const [holes, regs, groupRows, adminRows, revision] = await Promise.all([
    getEventHoles(eventId),
    getEventRegistrations(eventId),
    getEventGroups(eventId),
    getEventAdmins(eventId),
    getRevision(eventId),
  ]);
  const course = event.courseId ? await getCourseWithHoles(event.courseId) : null;
  return { event, holes, registrations: regs, groups: groupRows, admins: adminRows, course, revision };
}

export type CreateEventInput = {
  name: string;
  description?: string;
  date: string;
  startTime?: string;
  courseId?: string | null;
  format?: "STABLEFORD" | "STROKE_PLAY";
  handicapAllowance?: number;
  maxPlayers?: number;
  status?: EventStatus;
  isPublic?: boolean;
  createdBy: string;
  /** optional explicit card, used when an admin types in a brand new course */
  holes?: { holeNumber: number; par: number; strokeIndex: number }[];
  /**
   * Course details supplied while creating the golf day. Saved to the shared
   * library with the creator as author - this is how a first-time organiser adds
   * a course without needing library permissions up front.
   */
  newCourse?: {
    name: string;
    club?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    tees?: unknown;
    holes: { holeNumber: number; par: number; strokeIndex: number }[];
  };
  /** Provider course to import and attach in the same request. */
  importExternalId?: string | null;
};

export const DEFAULT_CARD: { holeNumber: number; par: number; strokeIndex: number }[] = [
  { holeNumber: 1, par: 4, strokeIndex: 9 },
  { holeNumber: 2, par: 4, strokeIndex: 5 },
  { holeNumber: 3, par: 3, strokeIndex: 15 },
  { holeNumber: 4, par: 5, strokeIndex: 3 },
  { holeNumber: 5, par: 4, strokeIndex: 11 },
  { holeNumber: 6, par: 4, strokeIndex: 1 },
  { holeNumber: 7, par: 3, strokeIndex: 17 },
  { holeNumber: 8, par: 5, strokeIndex: 7 },
  { holeNumber: 9, par: 4, strokeIndex: 13 },
  { holeNumber: 10, par: 4, strokeIndex: 10 },
  { holeNumber: 11, par: 3, strokeIndex: 16 },
  { holeNumber: 12, par: 4, strokeIndex: 6 },
  { holeNumber: 13, par: 5, strokeIndex: 2 },
  { holeNumber: 14, par: 4, strokeIndex: 12 },
  { holeNumber: 15, par: 4, strokeIndex: 8 },
  { holeNumber: 16, par: 3, strokeIndex: 18 },
  { holeNumber: 17, par: 5, strokeIndex: 4 },
  { holeNumber: 18, par: 4, strokeIndex: 14 },
];

export async function createEvent(input: CreateEventInput) {
  const id = newId();
  const slug = uniqueSlug(input.name);
  const joinCode = newJoinCode();

  // A course can arrive three ways: an id from the library, details typed in
  // with the event, or a provider id to import. All of them end up as a course
  // row authored by the person creating the event, who becomes its OWNER.
  let courseId = input.courseId ?? null;

  if (!courseId && input.newCourse) {
    const saved = await saveCourse(
      {
        name: input.newCourse.name,
        club: input.newCourse.club,
        address: input.newCourse.address,
        city: input.newCourse.city,
        country: input.newCourse.country,
        tees: input.newCourse.tees,
        holes: input.newCourse.holes,
        source: "MANUAL",
      },
      input.createdBy,
    );
    courseId = saved.courseId;
  }

  if (!courseId && input.importExternalId) {
    const provider = await fetchCourse(input.importExternalId);
    if (!provider) throw new ApiError(404, "That course could not be loaded from the provider", "not_found");
    if (provider.holes.length < 9) {
      throw new ApiError(422, "That course does not have a full scorecard", "incomplete_card");
    }
    const saved = await saveCourse(
      {
        name: provider.name,
        club: provider.club,
        address: provider.address ?? null,
        city: provider.city ?? null,
        country: provider.country ?? "England",
        latitude: provider.latitude ?? null,
        longitude: provider.longitude ?? null,
        tees: provider.tees,
        holes: provider.holes.map((h) => ({
          holeNumber: h.holeNumber,
          par: h.par,
          strokeIndex: h.strokeIndex,
          yards: h.yards,
        })),
        externalId: provider.externalId,
        source: provider.source,
      },
      input.createdBy,
    );
    courseId = saved.courseId;
  }

  let card = input.holes;
  let courseName: string | null = null;
  if (courseId) {
    const course = await getCourseWithHoles(courseId);
    if (!course) throw new ApiError(404, "Course not found", "course_not_found");
    courseName = [course.course.name, course.course.club].filter(Boolean).join(", ");
    if (!card) {
      card = course.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex }));
    }
    if (course.holes.length === 0 && !card) {
      throw new ApiError(400, "That course has no scorecard yet", "course_incomplete");
    }
  }
  if (!card || card.length === 0) card = DEFAULT_CARD;

  await db.insert(events).values({
    id,
    slug,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    date: input.date,
    startTime: input.startTime || "08:00",
    courseId,
    courseName,
    format: input.format ?? "STABLEFORD",
    handicapAllowance: input.handicapAllowance ?? 95,
    status: input.status ?? "DRAFT",
    maxPlayers: input.maxPlayers ?? 72,
    joinCode,
    isPublic: input.isPublic ?? true,
    createdBy: input.createdBy,
  });

  await db.insert(eventHoles).values(
    card.map((hole) => ({
      id: newId(),
      eventId: id,
      holeNumber: hole.holeNumber,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
    })),
  );
  await db.insert(eventAdmins).values({
    id: newId(),
    eventId: id,
    userId: input.createdBy,
    role: "OWNER",
  });
  await db.insert(eventState).values({ eventId: id, revision: 1 });

  return { id, slug };
}

/** A player may only be in one event on a given date (requirement 3 & 8). */
export async function findPlayerClash(playerId: string, eventId: string, date: string) {
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      date: events.date,
      startTime: events.startTime,
      status: events.status,
      slug: events.slug,
    })
    .from(eventPlayers)
    .innerJoin(events, eq(events.id, eventPlayers.eventId))
    .where(
      and(
        eq(eventPlayers.playerId, playerId),
        eq(eventPlayers.status, "REGISTERED"),
        eq(events.date, date),
        ne(events.id, eventId),
        ne(events.status, "CANCELLED"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findPlayerClashForDate(playerId: string, date: string) {
  const rows = await db
    .select({ id: events.id, name: events.name, startTime: events.startTime, slug: events.slug })
    .from(eventPlayers)
    .innerJoin(events, eq(events.id, eventPlayers.eventId))
    .where(
      and(
        eq(eventPlayers.playerId, playerId),
        eq(eventPlayers.status, "REGISTERED"),
        eq(events.date, date),
        ne(events.status, "CANCELLED"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Two flagged events on the same course & day would double-book the course. */
export async function findCourseClash(courseId: string, eventId: string, date: string, startTime: string) {
  const rows = await db
    .select({ id: events.id, name: events.name, startTime: events.startTime })
    .from(events)
    .where(
      and(
        eq(events.courseId, courseId),
        eq(events.date, date),
        ne(events.id, eventId),
        ne(events.status, "CANCELLED"),
      ),
    );
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const start = toMinutes(startTime);
  // a golf day occupies roughly six hours of the course
  return rows.find((row) => Math.abs(toMinutes(row.startTime) - start) < 6 * 60) ?? null;
}

export type RegisterPlayerInput = {
  eventId: string;
  playerId: string;
  groupId?: string | null;
  /** Player entering themselves (not an admin) - stricter group rules apply. */
  selfEntry?: boolean;
  tee?: string;
  status?: "REGISTERED" | "WAITLIST";
  force?: boolean;
};

/** Largest tee group a player can join on their own; admins can override. */
export const SELF_ENTRY_GROUP_LIMIT = 4;

export async function registerPlayer(input: RegisterPlayerInput) {
  const event = await getEventById(input.eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (event.status === "COMPLETED" || event.status === "CANCELLED") {
    throw new ApiError(409, `This event is ${event.status.toLowerCase()} and cannot take new entries`, "event_closed");
  }

  const [player] = await db.select().from(players).where(eq(players.id, input.playerId)).limit(1);
  if (!player) throw new ApiError(404, "Player not found", "player_not_found");

  const clash = await findPlayerClash(input.playerId, input.eventId, event.date);
  if (clash && !input.force) {
    throw new ApiError(
      409,
      `${player.name} is already playing "${clash.name}" on ${event.date}. A player can only play one event per day.`,
      "player_clash",
      clash,
    );
  }

  // The group must belong to this event - otherwise a crafted request could put
  // a player into another event's tee group (and hand them its scoring link).
  if (input.groupId) {
    const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
    if (!group || group.eventId !== input.eventId) {
      throw new ApiError(400, "That tee group is not part of this event", "invalid_group");
    }
    if (input.selfEntry) {
      const [{ count: inGroup }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(eventPlayers)
        .where(
          and(
            eq(eventPlayers.groupId, input.groupId),
            eq(eventPlayers.status, "REGISTERED"),
            ne(eventPlayers.playerId, input.playerId),
          ),
        );
      if (Number(inGroup) >= SELF_ENTRY_GROUP_LIMIT) {
        throw new ApiError(409, `${group.name} is full - pick another group`, "group_full");
      }
    }
  }

  const course = event.courseId ? await getCourseWithHoles(event.courseId) : null;
  const tees = parseTees(course?.course.tees);
  const tee: Tee = tees.find((t) => t.name.toLowerCase() === (input.tee ?? "White").toLowerCase()) ?? tees[0] ?? DEFAULT_TEE;
  const ch = courseHandicap(player.handicapIndex, tee);
  const ph = calcPlayingHandicap(ch, event.handicapAllowance);

  const [existing] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, input.eventId), eq(eventPlayers.playerId, input.playerId)))
    .limit(1);

  const registeredCount = async () => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(eventPlayers)
      .where(and(eq(eventPlayers.eventId, input.eventId), eq(eventPlayers.status, "REGISTERED")));
    return Number(count);
  };
  const wantStatus = input.status ?? "REGISTERED";

  if (existing) {
    // A withdrawn or waitlisted player coming back in takes a place, so the
    // field limit applies to them too (previously they skipped the check).
    if (existing.status !== "REGISTERED" && wantStatus === "REGISTERED" && !input.force) {
      if ((await registeredCount()) >= event.maxPlayers) {
        throw new ApiError(409, "This event is full", "event_full");
      }
    }
    await db
      .update(eventPlayers)
      .set({
        status: wantStatus,
        groupId: input.groupId ?? existing.groupId,
        tee: tee.name,
        handicapIndex: player.handicapIndex,
        courseHandicap: ch,
        playingHandicap: ph,
      })
      .where(eq(eventPlayers.id, existing.id));
  } else {
    if (wantStatus === "REGISTERED" && (await registeredCount()) >= event.maxPlayers && !input.force) {
      throw new ApiError(409, "This event is full", "event_full");
    }
    await db.insert(eventPlayers).values({
      id: newId(),
      eventId: input.eventId,
      playerId: input.playerId,
      groupId: input.groupId ?? null,
      status: wantStatus,
      handicapIndex: player.handicapIndex,
      courseHandicap: ch,
      playingHandicap: ph,
      tee: tee.name,
    });
  }
  await bumpRevision(input.eventId);
  return { ok: true, playingHandicap: ph, courseHandicap: ch };
}

/** Recalculate every playing handicap (e.g. after a handicap or allowance change). */
export async function recalculateHandicaps(eventId: string) {
  const event = await getEventById(eventId);
  if (!event) return;
  const course = event.courseId ? await getCourseWithHoles(event.courseId) : null;
  const tees = parseTees(course?.course.tees);
  const regs = await db
    .select({ registration: eventPlayers, player: players })
    .from(eventPlayers)
    .innerJoin(players, eq(players.id, eventPlayers.playerId))
    .where(eq(eventPlayers.eventId, eventId));

  for (const { registration, player } of regs) {
    const tee = tees.find((t) => t.name.toLowerCase() === registration.tee.toLowerCase()) ?? tees[0] ?? DEFAULT_TEE;
    const ch = courseHandicap(player.handicapIndex, tee);
    const ph = calcPlayingHandicap(ch, event.handicapAllowance);
    if (ch !== registration.courseHandicap || ph !== registration.playingHandicap || player.handicapIndex !== registration.handicapIndex) {
      await db
        .update(eventPlayers)
        .set({ handicapIndex: player.handicapIndex, courseHandicap: ch, playingHandicap: ph })
        .where(eq(eventPlayers.id, registration.id));
    }
  }
  await bumpRevision(eventId);
}

/** Allocate registered players into groups of `size` (existing groups kept). */
export async function autoAllocateGroups(eventId: string, size = 4, startTeeTime?: string) {
  const event = await getEventById(eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  const regs = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.status, "REGISTERED")));
  const existingGroups = await getEventGroups(eventId);

  const ungrouped = regs.filter((r) => !r.groupId);
  let groupRows = existingGroups;
  if (groupRows.length === 0) {
    const needed = Math.ceil(regs.length / size) || 1;
    const baseMinutes = toMinutes(event.startTime);
    const created = Array.from({ length: needed }, (_, i) => ({
      id: newId(),
      eventId,
      name: `Group ${i + 1}`,
      teeTime: formatMinutes(baseMinutes + i * 10 + (startTeeTime ? 0 : 0)),
      sortOrder: i,
      token: newToken(),
      createdAt: new Date().toISOString(),
    }));
    await db.insert(groups).values(created);
    groupRows = created;
  }

  // fill groups in order, keeping current members
  const counts = new Map<string, number>();
  for (const g of groupRows) counts.set(g.id, 0);
  for (const r of regs) if (r.groupId) counts.set(r.groupId, (counts.get(r.groupId) ?? 0) + 1);

  for (const reg of ungrouped) {
    const target = [...groupRows].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0];
    if (!target) break;
    if ((counts.get(target.id) ?? 0) >= size) {
      // everyone full: create one more group
      const next = {
        id: newId(),
        eventId,
        name: `Group ${groupRows.length + 1}`,
        teeTime: formatMinutes(toMinutes(event.startTime) + groupRows.length * 10),
        sortOrder: groupRows.length,
        token: newToken(),
        createdAt: new Date().toISOString(),
      };
      await db.insert(groups).values(next);
      groupRows.push(next);
      counts.set(next.id, 0);
      await db.update(eventPlayers).set({ groupId: next.id }).where(eq(eventPlayers.id, reg.id));
      counts.set(next.id, 1);
      continue;
    }
    await db.update(eventPlayers).set({ groupId: target.id }).where(eq(eventPlayers.id, reg.id));
    counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
  }
  await bumpRevision(eventId);
  return getEventGroups(eventId);
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatMinutes(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function createGroup(eventId: string, name?: string, teeTime?: string) {
  const event = await getEventById(eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  const existing = await getEventGroups(eventId);
  const [row] = await db
    .insert(groups)
    .values({
      id: newId(),
      eventId,
      name: name?.trim() || `Group ${existing.length + 1}`,
      teeTime: teeTime || formatMinutes(toMinutes(event.startTime) + existing.length * 10),
      sortOrder: existing.length,
      token: newToken(),
    })
    .returning();
  await bumpRevision(eventId);
  return row;
}

export async function deleteGroup(eventId: string, groupId: string) {
  await db.update(eventPlayers).set({ groupId: null }).where(eq(eventPlayers.groupId, groupId));
  await db.delete(groups).where(and(eq(groups.id, groupId), eq(groups.eventId, eventId)));
  await bumpRevision(eventId);
}

/**
 * Put a player into one of this event's tee groups (or take them out with
 * `groupId: null`).
 *
 * Requirement 4 says players mark their own group with no admin involved, so a
 * player may call this for themselves - but they get the same four-ball cap as
 * self-registration, and they must already be in the field. Event admins can
 * move anybody, including into a group that is already full.
 */
export async function setPlayerGroup(input: {
  eventId: string;
  playerId: string;
  groupId: string | null;
  isAdmin: boolean;
}) {
  const event = await getEventById(input.eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");

  const [registration] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, input.eventId), eq(eventPlayers.playerId, input.playerId)))
    .limit(1);
  if (!registration) throw new ApiError(404, "That player is not registered for this event", "not_found");

  if (input.groupId) {
    const [group] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.id, input.groupId), eq(groups.eventId, input.eventId)))
      .limit(1);
    if (!group) throw new ApiError(404, "Group not found", "not_found");

    if (!input.isAdmin) {
      if (registration.status !== "REGISTERED") {
        throw new ApiError(409, "Enter the golf day before picking a tee group", "not_registered");
      }
      // Don't count the player who is already in this group.
      const [{ count: inGroup }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(eventPlayers)
        .where(
          and(
            eq(eventPlayers.groupId, input.groupId),
            eq(eventPlayers.status, "REGISTERED"),
            ne(eventPlayers.playerId, input.playerId),
          ),
        );
      if (Number(inGroup) >= SELF_ENTRY_GROUP_LIMIT) {
        throw new ApiError(409, `${group.name} is full - pick another group`, "group_full");
      }
    }
  }

  await db
    .update(eventPlayers)
    .set({ groupId: input.groupId })
    .where(eq(eventPlayers.id, registration.id));
  await bumpRevision(input.eventId);
  return { ok: true, groupId: input.groupId };
}

export async function getGroupByToken(token: string) {
  const [group] = await db.select().from(groups).where(eq(groups.token, token)).limit(1);
  if (!group) return null;
  const event = await getEventById(group.eventId);
  if (!event) return null;
  return { group, event };
}

export async function listPublicEvents(limit = 30) {
  return db
    .select({
      event: events,
      // NB: `events.id` must be written as literal SQL. Interpolating ${events.id}
      // renders a bare "id", which SQLite resolves to the *string* 'id' inside the
      // subquery (its double-quoted-identifier fallback), so every count came back 0.
      playerCount: sql<number>`(select count(*) from event_players ep where ep.event_id = events.id and ep.status = 'REGISTERED')`,
    })
    .from(events)
    .where(and(eq(events.isPublic, true), ne(events.status, "DRAFT"), ne(events.status, "CANCELLED")))
    .orderBy(sql`${events.date} desc`)
    .limit(limit);
}

export async function listEventsForPlayer(playerId: string) {
  return db
    .select({ event: events, registration: eventPlayers })
    .from(eventPlayers)
    .innerJoin(events, eq(events.id, eventPlayers.eventId))
    .where(and(eq(eventPlayers.playerId, playerId), ne(eventPlayers.status, "WITHDRAWN")))
    .orderBy(sql`${events.date} desc`);
}

export async function listEventsForAdmin(userId: string) {
  return db
    .select({ event: events, role: eventAdmins.role })
    .from(eventAdmins)
    .innerJoin(events, eq(events.id, eventAdmins.eventId))
    .where(eq(eventAdmins.userId, userId))
    .orderBy(sql`${events.date} desc`);
}

export async function listEventsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(events).where(inArray(events.id, ids));
}
