/**
 * Invitations.
 *
 * Every competitor emails a tee sheet and a card link; until now GolfDay made
 * the organiser WhatsApp nineteen links by hand. This module composes one
 * message per player (their group, their tee time, their card link and the join
 * code), sends it through ./mailer and records it in `mail_outbox` either way.
 *
 * With no mail provider configured the whole batch is a dry run: the rows say
 * DRY_RUN and the organiser is told so, rather than the app claiming to have
 * emailed anybody.
 */
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventSettings, groups, mailOutbox, users } from "@/db/schema";
import { getEventBundle } from "./events";
import { newId } from "./ids";
import { looksLikeEmail, mailConfigured, sendMail, type MailResult } from "./mailer";
import { formatEventDate } from "./format";

export type InviteResult = {
  seat: { playerId: string; name: string; email: string; group: string | null; teeTime: string | null };
  status: MailResult["status"];
  error?: string;
};

export type InviteSummary = {
  /** false when no provider is configured: nothing left the building */
  delivered: boolean;
  sent: number;
  dryRun: number;
  failed: number;
  /** players with no usable address on file */
  noEmail: { playerId: string; name: string }[];
  results: InviteResult[];
};

export function inviteSubject(eventName: string, groupName: string | null, teeTime: string | null): string {
  if (!groupName) return `${eventName} - you're in the field`;
  return `${eventName} - ${groupName}${teeTime ? `, ${teeTime}` : ""}`;
}

/** The body an organiser would otherwise type out nineteen times. */
export function inviteBody(input: {
  playerName: string;
  event: { name: string; date: string; startTime: string; courseName: string | null; slug: string; joinCode: string };
  group: { name: string; teeTime: string | null } | null;
  cardUrl: string;
  leaderboardUrl: string;
  origin: string;
}): string {
  const firstName = input.playerName.split(/\s+/)[0] || "there";
  const tee = input.group?.teeTime ?? input.event.startTime;
  const lines = [
    `Hi ${firstName},`,
    "",
    `You're in ${input.event.name} at ${input.event.courseName ?? "the course"} on ${formatEventDate(input.event.date)}.`,
    "",
    input.group
      ? `Your tee group is ${input.group.name}, teeing off at ${tee}.`
      : `You're in the field; tee groups are published nearer the day.`,
    "",
    `Enter your group's card here (no app, no sign-in): ${input.cardUrl}`,
    `Watch the live leaderboard: ${input.leaderboardUrl}`,
    "",
    `Join code, if you need to change your entry: ${input.event.joinCode}`,
  ];
  if (!mailConfigured()) {
    lines.push("", "--", "Sent by GolfDay. Reply to your organiser if anything here is wrong.");
  }
  return lines.join("\n");
}

/**
 * Sends the field their cards. `origin` is the absolute site URL, taken from the
 * request so links work on a demo host and on a club's own domain alike.
 */
export async function sendInvites(eventId: string, origin: string): Promise<InviteSummary | null> {
  const bundle = await getEventBundle(eventId);
  if (!bundle) return null;
  const { event, registrations, groups: groupRows } = bundle;
  const groupLookup = new Map(groupRows.map((g) => [g.id, g]));

  const summary: InviteSummary = {
    delivered: mailConfigured(),
    sent: 0,
    dryRun: 0,
    failed: 0,
    noEmail: [],
    results: [],
  };

  for (const { registration, player } of registrations) {
    if (registration.status !== "REGISTERED") continue;
    const group = registration.groupId ? groupLookup.get(registration.groupId) : undefined;
    // Fall back to the sign-in address when the golfing profile has none.
    let address = player.email?.trim() ?? "";
    if (!looksLikeEmail(address) && player.userId) {
      const [account] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, player.userId))
        .limit(1);
      address = account?.email?.trim() ?? address;
    }
    if (!looksLikeEmail(address)) {
      summary.noEmail.push({ playerId: player.id, name: player.name });
      continue;
    }

    const message = {
      to: address,
      toName: player.name,
      subject: inviteSubject(event.name, group?.name ?? null, group?.teeTime ?? null),
      text: inviteBody({
        playerName: player.name,
        event,
        group: group ? { name: group.name, teeTime: group.teeTime } : null,
        cardUrl: group ? `${origin}/score/${group.token}` : `${origin}/events/${event.slug}`,
        leaderboardUrl: `${origin}/live/${event.slug}`,
        origin,
      }),
    };

    const result = await sendMail(message);
    await db.insert(mailOutbox).values({
      id: newId(),
      eventId,
      toEmail: address,
      toName: player.name,
      kind: "INVITE",
      subject: message.subject,
      body: message.text,
      status: result.status,
      providerId: result.providerId,
      error: result.status === "FAILED" ? result.error : null,
      sentAt: result.status === "SENT" ? new Date().toISOString() : null,
    });

    if (result.status === "SENT") summary.sent += 1;
    else if (result.status === "DRY_RUN") summary.dryRun += 1;
    else summary.failed += 1;

    summary.results.push({
      seat: {
        playerId: player.id,
        name: player.name,
        email: address,
        group: group?.name ?? null,
        teeTime: group?.teeTime ?? null,
      },
      status: result.status,
      error: result.status === "FAILED" ? result.error : undefined,
    });
  }

  return summary;
}

/** The most recent messages for an event, for the organiser console. */
export async function recentMail(eventId: string, limit = 20) {
  return db
    .select({
      id: mailOutbox.id,
      toName: mailOutbox.toName,
      toEmail: mailOutbox.toEmail,
      subject: mailOutbox.subject,
      status: mailOutbox.status,
      error: mailOutbox.error,
      createdAt: mailOutbox.createdAt,
    })
    .from(mailOutbox)
    .where(eq(mailOutbox.eventId, eventId))
    .orderBy(desc(mailOutbox.createdAt))
    .limit(limit);
}

/**
 * What the invitation batch needs from the event: the greetings text mentions
 * the group tee time, which lives on `groups`, so read the settings table too
 * (it is where an organiser's own sender name would live later).
 */
export async function inviteContext(eventId: string) {
  const [settings] = await db.select().from(eventSettings).where(eq(eventSettings.eventId, eventId)).limit(1);
  const rows = await db.select().from(groups).where(eq(groups.eventId, eventId)).orderBy(asc(groups.sortOrder));
  return { settings: settings ?? null, groups: rows };
}
