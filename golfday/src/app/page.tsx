import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { buildLeaderboard } from "@/lib/leaderboard";
import { formatEventDate } from "@/lib/format";
import { Arrow, FlagMark, LiveDot, Trophy } from "@/components/Icons";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const [live] = await db
    .select()
    .from(events)
    .where(eq(events.status, "IN_PROGRESS"))
    .orderBy(desc(events.date))
    .limit(1);
  const board = live ? await buildLeaderboard(live.id) : null;
  const top = board?.standings.filter((s) => s.thru > 0).slice(0, 3) ?? [];

  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-fairway-950 px-6 py-12 text-white sm:px-12 sm:py-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(700px 300px at 85% 0%, rgba(33,154,103,.55), transparent 65%), radial-gradient(500px 260px at 10% 110%, rgba(221,166,78,.28), transparent 60%)",
          }}
        />
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-fairway-100 ring-1 ring-inset ring-white/15">
              <FlagMark className="h-4 w-4 rounded-[5px]" /> Live scoring for golf days
            </div>
            <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              Run the golf day.<br />
              <span className="text-sand-300">Watch the leaderboard fill up.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fairway-100/80">
              Pick the course, pull handicaps from Golf England, put players into tee groups and send each
              group a live scorecard link. Every score updates the leaderboard instantly - no spreadsheets,
              no WhatsApp photo of a card.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={user ? "/admin/events/new" : "/register"} className="btn-sand">
                {user ? "Create a golf day" : "Get started free"} <Arrow />
              </Link>
              {live && (
                <Link href={`/live/${live.slug}`} className="btn bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/15">
                  <LiveDot /> Watch the live demo
                </Link>
              )}
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-fairway-100/65">
              <span>✓ Stableford &amp; net stroke play</span>
              <span>✓ WHS course handicaps</span>
              <span>✓ 18-hole card builder</span>
              <span>✓ No app to install</span>
            </div>
          </div>

          {/* Live preview card */}
          <div className="rounded-2xl bg-white/[0.06] p-2 ring-1 ring-inset ring-white/15">
            {live && board ? (
              <div className="rounded-xl bg-fairway-900/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-sand-300">
                      <LiveDot /> In progress
                    </div>
                    <div className="mt-1 text-[15px] font-bold">{live.name}</div>
                    <div className="text-[12px] text-fairway-100/60">{board.event.courseName}</div>
                  </div>
                  <span className="pill bg-white/10 text-fairway-100 ring-white/15">{formatEventDate(live.date)}</span>
                </div>
                <div className="mt-4 space-y-2">
                  {top.map((s, i) => (
                    <div key={s.playerId} className="flex items-center gap-3 rounded-lg bg-white/[0.05] px-3 py-2">
                      <span className="w-4 text-center text-[12px] font-bold text-sand-300">{i + 1}</span>
                      <span className="flex-1 truncate text-[13.5px] font-medium">{s.playerName}</span>
                      <span className="text-[11px] text-fairway-100/50">thru {s.thru}</span>
                      <span className="w-10 text-right font-mono text-[13.5px] font-bold">{s.points}</span>
                    </div>
                  ))}
                  {top.length === 0 && <div className="py-6 text-center text-[13px] text-fairway-100/60">Waiting for the first card…</div>}
                </div>
                <div className="mt-3 flex items-center justify-between text-[11.5px] text-fairway-100/50">
                  <span>{board.stats.registered} players · {board.stats.scoresEntered} holes scored</span>
                  <Link className="font-semibold text-sand-300 hover:text-sand-200" href={`/live/${live.slug}`}>
                    Full board →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-fairway-900/70 p-8 text-center text-[13px] text-fairway-100/60">
                No event in play right now - create one to see it here.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight">Everything a golf day needs</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink/60">
          Built around how a club actually runs an outing: one organiser, tee groups, a card per player and a
          leaderboard everybody can see.
        </p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Course catalogue, 18 holes", body: "Search a free course database or type your own par and stroke index card. The card is snapshotted per event so edits never rewrite history." },
            { title: "Players & handicaps", body: "Import players from a CSV or pull handicap indexes from Golf England. Course and playing handicaps are calculated with the WHS slope formula." },
            { title: "Tee groups & admin roles", body: "Auto-allocate four-balls, drag players between groups and give a helper scorer access to just one day." },
            { title: "Live group scorecards", body: "Each group gets a private link. Score entry is three taps: pick the hole, pick the player, tap the score - it saves instantly." },
            { title: "Live leaderboard", body: "A separate public URL for the clubhouse screen. It updates within two seconds of a card changing and shows thru, gross, points and to-par." },
            { title: "No double-bookings", body: "A player can only be entered in one event per day, and the course clash check warns you before two events overlap on the same course." },
          ].map((f) => (
            <div key={f.title} className="card card-pad">
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-fairway-50 text-fairway-700 ring-1 ring-inset ring-fairway-100">
                <Trophy className="h-4.5 w-4.5" />
              </div>
              <h3 className="text-[15px] font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live events strip */}
      <section className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Golf days happening soon</h2>
            <p className="text-[13.5px] text-ink/55">Public events you can watch or enter.</p>
          </div>
          <Link href="/events" className="btn-secondary btn-sm">Browse all events <Arrow /></Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {(await db.select().from(events).orderBy(desc(events.date)).limit(3)).map((event) => (
            <Link key={event.id} href={`/live/${event.slug}`} className="group rounded-xl border border-ink/[0.07] p-4 transition hover:border-fairway-200 hover:bg-fairway-50/40">
              <span className={`pill ${STATUS_STYLE[event.status]}`}>{STATUS_LABEL[event.status]}</span>
              <div className="mt-2.5 text-[14.5px] font-semibold group-hover:text-fairway-800">{event.name}</div>
              <div className="mt-0.5 text-[12.5px] text-ink/55">{event.courseName ?? "Course TBC"}</div>
              <div className="mt-1 text-[12px] text-ink/45">{formatEventDate(event.date)} · {event.startTime}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Demo credentials */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card card-pad bg-white">
          <h3 className="text-[15px] font-bold">Try the demo</h3>
          <p className="mt-1 text-[13.5px] text-ink/60">Two accounts are seeded with a day in progress and a completed day.</p>
          <dl className="mt-4 space-y-2 text-[13.5px]">
            <div className="flex items-center justify-between rounded-lg bg-ink/[0.03] px-3 py-2">
              <dt className="font-medium">Organiser</dt><dd className="font-mono text-[12.5px]">admin@golfday.app / golfday123</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-ink/[0.03] px-3 py-2">
              <dt className="font-medium">Player</dt><dd className="font-mono text-[12.5px]">sam@golfday.app / golfday123</dd>
            </div>
          </dl>
          <div className="mt-4 flex gap-2">
            <Link href="/login" className="btn-primary btn-sm">Sign in</Link>
            <Link href="/register" className="btn-secondary btn-sm">Create an account</Link>
          </div>
        </div>
        <div className="card card-pad">
          <h3 className="text-[15px] font-bold">Built to host for free</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink/60">
            Next.js on Vercel&apos;s free tier, a libSQL/SQLite database from Turso&apos;s free tier and no
            queue or worker services - live updates ride on Server-Sent Events. See
            <span className="font-medium text-ink/80"> docs/HOSTING.md</span> for the deploy runbook.
          </p>
        </div>
      </section>
    </div>
  );
}
