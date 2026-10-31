import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEventAccess } from "@/lib/http";
import { getCourseWithHoles, getEventBundle, STATUS_LABEL, STATUS_STYLE } from "@/lib/events";
import { buildLeaderboard } from "@/lib/leaderboard";
import { formatEventDate, formatToPar } from "@/lib/format";
import { EventEntry } from "@/components/EventEntry";
import { CopyButton } from "@/components/CopyButton";
import { PayEntryButton } from "@/components/PayEntryButton";
import { getGameSettings } from "@/lib/games";
import { formatPence, getPayment, stripeEnabled } from "@/lib/payments";
import { Arrow, LiveDot, Trophy } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { slug } = await params;
  const { payment: paymentResult } = await searchParams;
  const bundle = await getEventBundleBySlug(slug);
  if (!bundle) notFound();
  const { event, holes, registrations, groups } = bundle;
  const user = await getCurrentUser();
  const access = await getEventAccess(event.id, user);
  if (!event.isPublic && !access) notFound();

  const board = await buildLeaderboard(event.id);
  const course = event.courseId ? await getCourseWithHoles(event.courseId) : null;
  const mine = registrations.find((r) => r.player.id === user?.playerId);
  const par = holes.reduce((sum, h) => sum + h.par, 0);
  const front = holes.filter((h) => h.holeNumber <= 9);
  const back = holes.filter((h) => h.holeNumber > 9);
  const myGroup = mine?.registration.groupId ? groups.find((g) => g.id === mine.registration.groupId) : undefined;
  const settings = await getGameSettings(event.id);
  const myPayment = mine ? await getPayment(event.id, mine.player.id) : null;
  const feePence = settings.entryFeePence;
  const top = board?.standings.filter((s) => s.thru > 0).slice(0, 5) ?? [];

  return (
    <div className="space-y-5">
      <header className="card overflow-hidden">
        <div className="relative bg-fairway-950 px-5 py-6 text-white sm:px-7">
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(600px 240px at 90% 0%, rgba(33,154,103,.5), transparent 65%)" }} />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`pill ${STATUS_STYLE[event.status]}`}>
                  {event.status === "IN_PROGRESS" && <LiveDot />} {STATUS_LABEL[event.status]}
                </span>
                <span className="pill bg-white/10 text-white/80 ring-white/15">{event.format === "STABLEFORD" ? "Stableford" : "Net stroke play"}</span>
                <span className="pill bg-white/10 text-white/80 ring-white/15">{event.handicapAllowance}% allowance</span>
              </div>
              <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{event.name}</h1>
              <p className="mt-1 text-[13.5px] text-fairway-100/70">
                {event.courseName ?? "Course TBC"} · {formatEventDate(event.date)} · tee off {event.startTime}
              </p>
              {event.description && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-fairway-100/60">{event.description}</p>}
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <Link href={`/live/${event.slug}`} className="btn-sand btn-sm">
                {event.status === "IN_PROGRESS" ? "Live leaderboard" : "Leaderboard"} <Arrow />
              </Link>
              {access?.isAdmin && (
                <Link href={`/admin/events/${event.id}`} className="btn bg-white/10 btn-sm text-white ring-1 ring-inset ring-white/20 hover:bg-white/15">
                  Organiser console
                </Link>
              )}
              <CopyButton value={`/live/${event.slug}`} label="Share leaderboard" className="btn bg-white/10 btn-sm text-white ring-1 ring-inset ring-white/20 hover:bg-white/15" />
            </div>
          </div>
        </div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1.4fr_1fr] sm:px-7">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Players" value={`${registrations.length}/${event.maxPlayers}`} />
            <Fact label="Tee groups" value={String(groups.length)} />
            <Fact label="Par" value={String(par)} />
            <Fact label="Join code" value={event.joinCode} mono />
          </div>
          <div className="rounded-xl bg-ink/[0.03] p-3">
            <EventEntry
              eventId={event.id}
              playerId={user?.playerId ?? null}
              registered={Boolean(mine)}
              canSelfEnter={["OPEN", "IN_PROGRESS"].includes(event.status)}
              groups={groups.map((g) => ({ id: g.id, name: g.name, teeTime: g.teeTime }))}
              myGroupId={mine?.registration.groupId ?? null}
              isAdmin={Boolean(access?.isAdmin)}
            />
            {mine && myGroup && (
              <Link href={`/score/${myGroup.token}`} className="btn-primary btn-sm mt-2 w-full">
                Enter my group&apos;s scores
              </Link>
            )}
            {paymentResult === "paid" && (
              <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-700">Payment received - you&apos;re all set.</p>
            )}
            {feePence > 0 && mine && (
              myPayment?.status === "PAID" ? (
                <p className="mt-2 text-[12.5px] font-medium text-emerald-700">Entry fee paid · {formatPence(myPayment.amountPence)}</p>
              ) : stripeEnabled() ? (
                <PayEntryButton eventId={event.id} label={`Pay entry · ${formatPence(feePence)}`} />
              ) : (
                <p className="mt-2 text-[12.5px] text-ink/70">Entry fee {formatPence(feePence)} - pay the organiser on the day.</p>
              )
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <section className="card">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">Live standing</h2>
              <Link href={`/live/${event.slug}`} className="text-[12.5px] font-semibold text-fairway-700 hover:text-fairway-900">Full leaderboard →</Link>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">Pos</th><th>Player</th><th className="text-center">Thru</th>
                  <th className="text-center">{event.format === "STABLEFORD" ? "Pts" : "Net"}</th>
                  <th className="text-center">To par</th>
                </tr>
              </thead>
              <tbody>
                {top.map((s) => (
                  <tr key={s.playerId}>
                    <td className="font-mono text-[13px] font-bold text-ink/60">{s.tied ? `T${s.position}` : s.position}</td>
                    <td>
                      <div className="flex items-center gap-2 font-semibold">
                        {s.playerName}
                        {s.position === 1 && <Trophy className="h-3.5 w-3.5 text-sand-500" />}
                      </div>
                      <div className="text-[11.5px] text-ink/45">{s.groupName ?? "No group"} · PH {s.playingHandicap}</div>
                    </td>
                    <td className="text-center font-mono text-[13px]">{s.thru}</td>
                    <td className="text-center font-mono text-[15px] font-extrabold">{event.format === "STABLEFORD" ? s.points : formatToPar(s.netToPar)}</td>
                    <td className="text-center font-mono text-[13px] text-ink/60">{formatToPar(s.toPar)}</td>
                  </tr>
                ))}
                {top.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[13px] text-ink/45">No scores on the board yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">Tee groups</h2>
            </div>
            <ul className="divide-y divide-ink/[0.06]">
              {groups.map((group) => {
                const members = registrations.filter((r) => r.registration.groupId === group.id);
                return (
                  <li key={group.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[14px] font-semibold">{group.name}</span>
                        {group.teeTime && <span className="ml-2 text-[12px] text-ink/45">{group.teeTime}</span>}
                      </div>
                      {(access?.isAdmin || mine?.registration.groupId === group.id) && (
                        <div className="flex gap-2">
                          <Link href={`/score/${group.token}`} className="btn-secondary btn-sm">Scorecard</Link>
                          <CopyButton value={`/score/${group.token}`} label="Copy link" />
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {members.length === 0 && <span className="text-[12.5px] text-ink/40">Nobody assigned yet</span>}
                      {members.map(({ player, registration }) => (
                        <span key={player.id} className="rounded-full bg-ink/[0.05] px-2.5 py-1 text-[12px] text-ink/70">
                          {player.name} <span className="text-ink/40">· PH {registration.playingHandicap}</span>
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
              {groups.length === 0 && <li className="px-5 py-6 text-center text-[13px] text-ink/45">The organiser has not published groups yet.</li>}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">The card</h2>
              {access?.isAdmin && <Link href={`/admin/events/${event.id}#card`} className="text-[12px] font-semibold text-fairway-700">Edit</Link>}
            </div>
            <div className="overflow-x-auto px-3 py-3">
              <HoleTable label="Front nine" holes={front} />
              <HoleTable label="Back nine" holes={back} />
            </div>
            <div className="border-t border-ink/[0.06] px-5 py-3 text-[12px] text-ink/50">
              {course?.course.address ? `${course.course.address}, ${course.course.city ?? ""}` : "Course details managed by the event admin"}
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-[15px] font-bold">Organisers</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] text-ink/70">
              {bundle.admins.map((admin) => (
                <li key={admin.id} className="flex items-center justify-between gap-2">
                  <span className="font-medium">{admin.name}</span>
                  <span className="pill bg-ink/[0.04] text-ink/50 ring-ink/10">{admin.role.toLowerCase()}</span>
                </li>
              ))}
              {bundle.admins.length === 0 && <li className="text-ink/45">Not published</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

async function getEventBundleBySlug(slug: string) {
  const { getEventBySlug } = await import("@/lib/events");
  const event = await getEventBySlug(slug);
  if (!event) return null;
  return getEventBundle(event.id);
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-ink/[0.03] px-3 py-2 ring-1 ring-inset ring-ink/[0.06]">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/40">{label}</div>
      <div className={`text-[15px] font-bold leading-tight ${mono ? "font-mono tracking-wider" : ""}`}>{value}</div>
    </div>
  );
}

function HoleTable({ label, holes }: { label: string; holes: { holeNumber: number; par: number; strokeIndex: number }[] }) {
  if (holes.length === 0) return null;
  const par = holes.reduce((sum, h) => sum + h.par, 0);
  return (
    <table className="w-full min-w-[300px] border-separate border-spacing-0 text-[11.5px]">
      <thead>
        <tr className="text-ink/40">
          <th className="px-1 py-1 text-left font-semibold">{label}</th>
          {holes.map((h) => <th key={h.holeNumber} className="px-1 py-1 text-center font-semibold">{h.holeNumber}</th>)}
          <th className="px-1 py-1 text-center font-semibold">Tot</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="px-1 font-medium text-ink/50">Par</td>
          {holes.map((h) => <td key={h.holeNumber} className="px-1 text-center font-mono">{h.par}</td>)}
          <td className="px-1 text-center font-mono font-bold">{par}</td>
        </tr>
        <tr>
          <td className="px-1 font-medium text-ink/50">SI</td>
          {holes.map((h) => <td key={h.holeNumber} className="px-1 text-center font-mono text-ink/55">{h.strokeIndex}</td>)}
          <td className="px-1" />
        </tr>
      </tbody>
    </table>
  );
}
