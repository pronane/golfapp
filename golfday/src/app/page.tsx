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
      <section className="hero relative overflow-hidden rounded-[28px] px-6 py-12 shadow-card ring-1 ring-inset ring-fairway-200/70 sm:px-12 sm:py-14">
        <div className="relative grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-fairway-800 ring-1 ring-inset ring-fairway-200">
              <FlagMark className="h-4 w-4 rounded-[5px]" /> Live scoring for golf days
            </div>
            <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-fairway-950 sm:text-5xl">
              Run the golf day.<br />
              <span className="text-fairway-600">Watch the leaderboard fill up.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fairway-800/80">
              One organiser, a handful of friends or a whole society: pick the course (or type the card in),
              put players into tee groups and send each group a live scorecard link. Every score updates the
              leaderboard instantly - no spreadsheets, no WhatsApp photo of a card.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={user ? "/admin/events/new" : "/register"} className="btn-primary">
                {user ? "Create a golf day" : "Get started free"} <Arrow />
              </Link>
              {live && (
                <Link href={`/live/${live.slug}`} className="btn-secondary">
                  <LiveDot /> Watch the live demo
                </Link>
              )}
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-fairway-800/70">
              <span>✓ Free to run</span>
              <span>✓ No club or handicap needed</span>
              <span>✓ Cash or card, your choice</span>
              <span>✓ No app to install</span>
            </div>
          </div>

          {/* Live preview card */}
          <div className="rounded-2xl bg-white/60 p-2 ring-1 ring-inset ring-fairway-200/80">
            {live && board ? (
              <div className="rounded-xl bg-white/80 p-4 ring-1 ring-inset ring-fairway-100">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-fairway-600">
                      <LiveDot /> In progress
                    </div>
                    <div className="mt-1 text-[15px] font-bold text-fairway-950">{live.name}</div>
                    <div className="text-[12px] text-fairway-800/60">{board.event.courseName}</div>
                  </div>
                  <span className="pill bg-sand-100 text-sand-700 ring-sand-200">{formatEventDate(live.date)}</span>
                </div>
                <div className="mt-4 space-y-2">
                  {top.map((s, i) => (
                    <div key={s.playerId} className="flex items-center gap-3 rounded-lg bg-fairway-50 px-3 py-2 ring-1 ring-inset ring-fairway-100">
                      <span className="w-4 text-center text-[12px] font-bold text-fairway-600">{i + 1}</span>
                      <span className="flex-1 truncate text-[13.5px] font-medium text-fairway-950">{s.playerName}</span>
                      <span className="text-[11px] text-fairway-800/50">thru {s.thru}</span>
                      <span className="w-10 text-right font-mono text-[13.5px] font-bold text-fairway-900">{s.points}</span>
                    </div>
                  ))}
                  {top.length === 0 && <div className="py-6 text-center text-[13px] text-fairway-800/60">Waiting for the first card…</div>}
                </div>
                <div className="mt-3 flex items-center justify-between text-[11.5px] text-fairway-800/50">
                  <span>{board.stats.registered} players · {board.stats.scoresEntered} holes scored</span>
                  <Link className="font-semibold text-fairway-700 hover:text-fairway-900" href={`/live/${live.slug}`}>
                    Full board →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-white/70 p-8 text-center text-[13px] text-fairway-800/60 ring-1 ring-inset ring-fairway-100">
                No event in play right now - create one to see it here.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Two ways in */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card card-pad ring-1 ring-inset ring-blush-200/70">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-blush-100 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-blush-600">
            Friends &amp; family
          </div>
          <h2 className="text-xl font-bold tracking-tight">One day, a few friends</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink/65">
            No society, no committee, no card payments to set up. Put the four-ball together, split the
            green fee in cash, and hand out one scorecard link. It takes about five minutes and costs nothing.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px] text-ink/60">
            <li>✓ Course not on the list? Type the card in yourself.</li>
            <li>✓ <span className="font-medium text-ink/80">Cash on the day</span> - tick people off as they pay you.</li>
            <li>✓ Anyone can play with no handicap, or a rough one.</li>
          </ul>
          <Link href={user ? "/admin/events/new" : "/register"} className="btn-primary btn-sm mt-4">
            Set up a day with friends <Arrow />
          </Link>
        </div>
        <div className="card card-pad ring-1 ring-inset ring-fairway-200/70">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-fairway-100 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-fairway-700">
            Clubs &amp; societies
          </div>
          <h2 className="text-xl font-bold tracking-tight">A whole season</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink/65">
            A society with a roster, fixtures through the year, a season order of merit, tee groups drawn
            automatically and handicaps pulled from your club&apos;s own system where you have credentials.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px] text-ink/60">
            <li>✓ Roster, join code and roles for the committee.</li>
            <li>✓ WHS, GHIN, iGolf or a society handicap - all welcome.</li>
            <li>✓ Card payments with refunds, if you want them.</li>
          </ul>
          <Link href={user ? "/societies" : "/register"} className="btn-secondary btn-sm mt-4">
            Start a society <Arrow />
          </Link>
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-2xl font-bold tracking-tight">Everything a golf day needs</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-ink/60">
          Built around how people actually run an outing - one organiser, tee groups, a card per player and a
          leaderboard everybody can see.
        </p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Course catalogue, 18 holes", body: "Search a free course database or type your own par and stroke index card. The card is snapshotted per event so edits never rewrite history." },
            { title: "Players & handicaps", body: "Type them in, import a CSV or pull indexes from a national database. A player with no handicap at all can still enter. Course and playing handicaps use the WHS slope formula." },
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
            Next.js on a free host, a libSQL/SQLite database from Turso&apos;s free tier and no queue or
            worker services - live updates ride on Server-Sent Events. This demo runs on a free Render
            service; <span className="font-medium text-ink/80">docs/PUBLIC-DEMO.md</span> has the deploy
            runbook.
          </p>
        </div>
      </section>
    </div>
  );
}
