/**
 * Societies - the club behind the golf days.
 *
 * A society owns a fixture list, a roster and its seasons (orders of merit).
 * Membership is by *player*, not user: guests added by a secretary can be on
 * the roster before they ever sign in, exactly like event registration.
 *
 * Roles: the founder is OWNER; OWNER and SECRETARY can run the society (add
 * fixtures, manage the roster, create seasons); everybody else is a MEMBER.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, events, players, seasons, societyEvents, societyMembers, societies } from "@/db/schema";
import type { SessionUser } from "./auth";
import { ApiError } from "./http";
import { newId, newJoinCode, uniqueSlug } from "./ids";
import { maskSecret, sealSecret } from "./secrets";

export type SocietyRole = "OWNER" | "SECRETARY" | "MEMBER";
export type SocietyRecord = typeof societies.$inferSelect;

export function canManageSociety(user: SessionUser | null, role: SocietyRole | null): boolean {
  if (!user) return false;
  if (user.isSiteAdmin) return true;
  return role === "OWNER" || role === "SECRETARY";
}

export async function createSociety(input: {
  name: string;
  description?: string | null;
  homeClub?: string | null;
  createdBy: string;
  /** The founder's player row - societies are rosters of players. */
  foundedByPlayerId: string | null;
}) {
  const id = newId();
  const slug = uniqueSlug(input.name);
  const joinCode = newJoinCode();
  await db.insert(societies).values({
    id,
    slug,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    homeClub: input.homeClub?.trim() || null,
    joinCode,
    createdBy: input.createdBy,
  });
  if (input.foundedByPlayerId) {
    await db.insert(societyMembers).values({
      id: newId(),
      societyId: id,
      playerId: input.foundedByPlayerId,
      role: "OWNER",
      status: "ACTIVE",
    });
  }
  return { id, slug, joinCode };
}

export async function getSocietyById(id: string) {
  const [row] = await db.select().from(societies).where(eq(societies.id, id)).limit(1);
  return row ?? null;
}

export async function getSocietyBySlug(slug: string) {
  const [row] = await db.select().from(societies).where(eq(societies.slug, slug)).limit(1);
  return row ?? null;
}

export async function getSocietyByJoinCode(code: string) {
  const [row] = await db.select().from(societies).where(eq(societies.joinCode, code.trim().toUpperCase())).limit(1);
  return row ?? null;
}

export async function listSocietyMembers(societyId: string) {
  const rows = await db
    .select({
      member: societyMembers,
      player: players,
    })
    .from(societyMembers)
    .innerJoin(players, eq(players.id, societyMembers.playerId))
    .where(eq(societyMembers.societyId, societyId))
    .orderBy(asc(players.name));
  return rows.map(({ member, player }) => ({
    playerId: player.id,
    name: player.name,
    handicapIndex: player.handicapIndex,
    homeClub: player.homeClub,
    role: member.role as SocietyRole,
    status: member.status,
    joinedAt: member.joinedAt,
  }));
}

export type SocietyMemberRow = Awaited<ReturnType<typeof listSocietyMembers>>[number];

/** The signed-in user's own membership of a society (null when not a member). */
export async function getMembership(societyId: string, user: SessionUser | null) {
  if (!user?.playerId) return null;
  const [row] = await db
    .select()
    .from(societyMembers)
    .where(and(eq(societyMembers.societyId, societyId), eq(societyMembers.playerId, user.playerId)))
    .limit(1);
  if (!row) return null;
  return { ...row, role: row.role as SocietyRole };
}

/** Throws unless the user runs the society (site admins always do). */
export async function requireSocietyRole(
  user: SessionUser,
  societyId: string,
  roles: SocietyRole[] = ["OWNER", "SECRETARY"],
): Promise<{ society: SocietyRecord; role: SocietyRole }> {
  const society = await getSocietyById(societyId);
  if (!society) throw new ApiError(404, "Society not found", "not_found");
  if (user.isSiteAdmin) return { society, role: "OWNER" };
  const membership = await getMembership(societyId, user);
  if (!membership || !roles.includes(membership.role)) {
    throw new ApiError(403, "Only the society's owner or secretary can do that", "forbidden");
  }
  return { society, role: membership.role };
}

export async function addSocietyMember(societyId: string, playerId: string, role: SocietyRole = "MEMBER") {
  const [existing] = await db
    .select()
    .from(societyMembers)
    .where(and(eq(societyMembers.societyId, societyId), eq(societyMembers.playerId, playerId)))
    .limit(1);
  if (existing) {
    if (existing.role !== role && role !== "OWNER") {
      await db.update(societyMembers).set({ role }).where(eq(societyMembers.id, existing.id));
    }
    return { added: false };
  }
  await db.insert(societyMembers).values({ id: newId(), societyId, playerId, role, status: "ACTIVE" });
  return { added: true };
}

export async function removeSocietyMember(societyId: string, playerId: string) {
  await db
    .delete(societyMembers)
    .where(and(eq(societyMembers.societyId, societyId), eq(societyMembers.playerId, playerId)));
}

/** A club cannot be left without an owner. */
export async function isLastOwner(societyId: string, playerId: string): Promise<boolean> {
  const owners = await db
    .select()
    .from(societyMembers)
    .where(and(eq(societyMembers.societyId, societyId), eq(societyMembers.role, "OWNER")));
  return owners.length === 1 && owners[0]?.playerId === playerId;
}

export async function listSocietiesForPlayer(playerId: string) {
  const rows = await db
    .select({ society: societies, member: societyMembers })
    .from(societyMembers)
    .innerJoin(societies, eq(societies.id, societyMembers.societyId))
    .where(eq(societyMembers.playerId, playerId))
    .orderBy(asc(societies.name));
  return rows.map(({ society, member }) => ({ ...society, role: member.role as SocietyRole }));
}

export async function listSocietyEvents(societyId: string) {
  const rows = await db
    .select({ event: events })
    .from(societyEvents)
    .innerJoin(events, eq(events.id, societyEvents.eventId))
    .where(eq(societyEvents.societyId, societyId))
    .orderBy(asc(events.date));
  return rows.map((r) => r.event);
}

/**
 * The handicap integration a society has configured, as safe-to-display data.
 * Credentials are never returned - only whether they exist and their shape.
 */
export async function getSocietyIntegration(societyId: string) {
  const [society] = await db.select().from(societies).where(eq(societies.id, societyId)).limit(1);
  if (!society) return null;
  return {
    societyId: society.id,
    source: (society.handicapSource ?? "DIRECTORY") as "MANUAL" | "DIRECTORY" | "WHS" | "CDH",
    country: society.handicapCountry ?? "eng",
    apiBase: society.handicapApiBase ?? "",
    username: society.handicapApiUsername ?? "",
    hasSecret: Boolean(society.handicapApiSecret),
    hasClientToken: Boolean(society.handicapClientToken),
    secretMask: maskSecret(society.handicapApiSecret),
    updatedAt: society.handicapUpdatedAt,
  };
}

/**
 * Saves a society's handicap integration. Owners and secretaries only; the
 * caller checks the role. An empty string clears a credential, `undefined`
 * leaves it untouched, so the UI can show a masked secret and still save.
 */
export async function updateSocietyIntegration(
  societyId: string,
  input: {
    source?: "MANUAL" | "DIRECTORY" | "WHS" | "CDH";
    country?: string;
    apiBase?: string;
    username?: string;
    secret?: string;
    clientToken?: string;
  },
) {
  const set: Record<string, unknown> = { handicapUpdatedAt: new Date().toISOString() };
  if (input.source) set.handicapSource = input.source;
  if (input.country) set.handicapCountry = input.country.toLowerCase();
  if (input.apiBase !== undefined) set.handicapApiBase = input.apiBase.trim() || null;
  if (input.username !== undefined) set.handicapApiUsername = input.username.trim() || null;
  if (input.secret !== undefined) set.handicapApiSecret = input.secret ? sealSecret(input.secret) : null;
  if (input.clientToken !== undefined) set.handicapClientToken = input.clientToken ? sealSecret(input.clientToken) : null;
  await db.update(societies).set(set).where(eq(societies.id, societyId));
  return getSocietyIntegration(societyId);
}

/**
 * The society behind an event, plus who is on its roster and not yet entered.
 * This is what makes a society worth having: the field is picked from the
 * roster, not re-typed from the whole player directory every month.
 */
export async function getSocietyRosterForEvent(eventId: string) {
  const society = await getSocietyForEvent(eventId);
  if (!society) return null;
  const members = (await listSocietyMembers(society.id)).filter((m) => m.status === "ACTIVE");
  const entered = new Set(
    (
      await db
        .select({ playerId: eventPlayers.playerId })
        .from(eventPlayers)
        .where(eq(eventPlayers.eventId, eventId))
    ).map((r) => r.playerId),
  );
  return {
    society: { id: society.id, name: society.name, slug: society.slug, joinCode: society.joinCode },
    members,
    missing: members.filter((m) => !entered.has(m.playerId)),
  };
}

export async function getSocietyForEvent(eventId: string) {
  const [link] = await db.select().from(societyEvents).where(eq(societyEvents.eventId, eventId)).limit(1);
  if (!link) return null;
  return getSocietyById(link.societyId);
}

/**
 * Attaches a fixture to a society. One society per event: attaching an event
 * that already belongs elsewhere moves it (the caller checks permissions).
 */
export async function attachEventToSociety(societyId: string, eventId: string) {
  const [existing] = await db.select().from(societyEvents).where(eq(societyEvents.eventId, eventId)).limit(1);
  if (existing?.societyId === societyId) return { attached: false };
  if (existing) {
    await db.delete(societyEvents).where(eq(societyEvents.eventId, eventId));
  }
  await db.insert(societyEvents).values({ id: newId(), societyId, eventId });
  return { attached: true };
}

export async function detachEventFromSociety(societyId: string, eventId: string) {
  await db.delete(societyEvents).where(and(eq(societyEvents.societyId, societyId), eq(societyEvents.eventId, eventId)));
}

/** Seasons are part of the society toolkit, so the list lives here too. */
export async function listSocietySeasons(societyId: string) {
  return db.select().from(seasons).where(eq(seasons.societyId, societyId)).orderBy(asc(seasons.startsOn));
}

/** Everything the society page shows. */
export async function getSocietyPage(slug: string) {
  const society = await getSocietyBySlug(slug);
  if (!society) return null;
  const [members, fixtures, societySeasons] = await Promise.all([
    listSocietyMembers(society.id),
    listSocietyEvents(society.id),
    listSocietySeasons(society.id),
  ]);
  return { society, members, fixtures, seasons: societySeasons };
}

export async function countSocietyMembers(societyId: string) {
  const rows = await db.select({ id: societyMembers.id }).from(societyMembers).where(eq(societyMembers.societyId, societyId));
  return rows.length;
}
