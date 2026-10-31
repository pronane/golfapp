import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { listEventsForAdmin, listEventsForPlayer, STATUS_LABEL, STATUS_STYLE } from "@/lib/events";
import { buildLeaderboard } from "@/lib/leaderboard";
import { formatEventDate, formatToPar } from "@/lib/format";
import { ProfileCard } from "@/components/ProfileCard";
import { ClaimPlayer } from "@/components/ClaimPlayer";
import { Arrow, LiveDot, Trophy } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const [player] = user.playerId
    ? await db.select().from(players).where(eq(players.id, user.playerId)).limit(1)
    : [null];
  const myEvents = user.playerId ? await listEventsForPlayer(user.playerId) : [];
  const adminEvents = await listEventsForAdmin(user.id);
  const liveEvent = myEvents.find(({ event }) => event.status === "IN_PROGRESS");
  const liveBoard = liveEvent ? await buildLeaderboard(liveEvent.event.id) : null;
  const myRow = liveBoard?.standings.find((s) => s.playerId === user.playerId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-fairway-700/70">My golf</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Hello, {user.name.split(" ")[0]}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/events" className="btn-secondary btn-sm">Find a golf day</Link>
          <Link href="/admin/events/new" className="btn-primary btn-sm">Create one <Arrow /></Link>
        </div>
      </div>

      {liveBoard && liveEvent && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/[0.06] bg-amber-50/60 px-5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
              <LiveDot /> You&apos;re on the course today
            </div>
            <Link href={`/live/${liveEvent.event.slug}`} className="text-[13px] font-semibold text-fairway-700 hover:text-fairway-900">
              Open live leaderboard →
            </Link>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-[1.3fr_1fr] sm:items-center">
            <div>
              <h2 className="text-lg font-bold">{liveEvent.event.name}</h2>
              <p className="text-[13px] text-ink/55">{liveEvent.event.courseName} · {formatEventDate(liveEvent.event.date)} · {liveEvent.event.startTime}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
                <span className="pill bg-fairway-50 text-fairway-700 ring-fairway-200">Group {liveBoard.groups.find((g) => g.id === liveEvent.registration.groupId)?.name.replace("Group ", "") ?? "—"}</span>
                <span className="pill bg-ink/[0.04] text-ink/60 ring-ink/10">Playing handicap {liveEvent.registration.playingHandicap}</span>
                <span className="pill bg-ink/[0.04] text-ink/60 ring-ink/10">{liveEvent.registration.tee} tees</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Position" value={myRow ? `${myRow.position}` : "—"} sub={myRow?.tied ? "tied" : ""} />
              <Stat label="Points" value={myRow ? String(myRow.points) : "0"} sub={liveBoard.event.format === "STABLEFORD" ? "stableford" : "stroke"} />
              <Stat label="Thru" value={myRow ? String(myRow.thru) : "0"} sub={`of ${liveBoard.holes.length}`} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] px-5 py-3">
            <Link href={`/score/${liveBoard.groups.find((g) => g.id === liveEvent.registration.groupId)?.token ?? ""}`} className="btn-primary btn-sm">
              Enter scores for my group
            </Link>
            <Link href={`/events/${liveEvent.event.slug}`} className="btn-secondary btn-sm">Event details</Link>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <section className="card">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">My entries</h2>
              <span className="text-[12px] text-ink/45">{myEvents.length} event{myEvents.length === 1 ? "" : "s"}</span>
            </div>
            {myEvents.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13.5px] text-ink/55">You are not entered in anything yet.</p>
                <Link href="/events" className="btn-secondary btn-sm mt-3">Browse golf days</Link>
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.06]">
                {myEvents.map(({ event, registration }) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/events/${event.slug}`} className="truncate text-[14px] font-semibold hover:text-fairway-800">{event.name}</Link>
                        <span className={`pill ${STATUS_STYLE[event.status]}`}>{STATUS_LABEL[event.status]}</span>
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-ink/50">
                        {formatEventDate(event.date)} · {event.courseName ?? "Course TBC"} · playing HCP {registration.playingHandicap}
                      </div>
                    </div>
                    <Link href={`/live/${event.slug}`} className="btn-ghost btn-sm">Leaderboard</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">Events I organise</h2>
              <Link href="/admin" className="text-[12.5px] font-semibold text-fairway-700 hover:text-fairway-900">Organiser console →</Link>
            </div>
            {adminEvents.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-[13.5px] text-ink/55">You are not an admin of any event yet.</p>
                <Link href="/admin/events/new" className="btn-primary btn-sm mt-3">Create a golf day</Link>
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.06]">
                {adminEvents.slice(0, 5).map(({ event, role }) => (
                  <li key={event.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{event.name}</div>
                      <div className="text-[12.5px] text-ink/50">{formatEventDate(event.date)} · {role.toLowerCase()}</div>
                    </div>
                    <Link href={`/admin/events/${event.id}`} className="btn-secondary btn-sm">Manage</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <ProfileCard
            player={
              player
                ? {
                    id: player.id,
                    name: player.name,
                    handicapIndex: player.handicapIndex,
                    homeClub: player.homeClub,
                    golfEnglandId: player.golfEnglandId,
                    handicapSource: player.handicapSource,
                    handicapUpdatedAt: player.handicapUpdatedAt,
                  }
                : null
            }
          />
          <ClaimPlayer />
          <div className="card card-pad">
            <h2 className="flex items-center gap-2 text-[15px] font-bold"><Trophy className="h-4 w-4 text-sand-500" /> How handicaps work here</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink/60">
              Your handicap index is converted to a course handicap using the tee&apos;s slope and rating
              (<span className="font-mono text-[12px]">index × slope ÷ 113 + (rating − par)</span>), then the
              event&apos;s allowance (usually 95% for Stableford) gives your playing handicap. Strokes are given
              on holes by stroke index.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-ink/[0.03] px-2 py-2.5 ring-1 ring-inset ring-ink/[0.06]">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/40">{label}</div>
      <div className="text-xl font-extrabold leading-tight tracking-tight">{value}</div>
      {sub && <div className="text-[10.5px] text-ink/40">{sub}</div>}
    </div>
  );
}
