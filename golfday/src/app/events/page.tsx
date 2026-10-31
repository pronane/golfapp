import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listPublicEvents, STATUS_LABEL, STATUS_STYLE } from "@/lib/events";
import { formatEventDate } from "@/lib/format";
import { JoinByCode } from "@/components/JoinByCode";
import { LiveDot } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/events");
  const rows = await listPublicEvents(60);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-fairway-700/70">Fixture list</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Golf days</h1>
          <p className="mt-1 text-[14px] text-ink/55">Open events you can enter, watch live, or both.</p>
        </div>
        <Link href="/admin/events/new" className="btn-primary btn-sm">Create a golf day</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-3">
          {rows.length === 0 && (
            <div className="card card-pad text-center text-[14px] text-ink/55">
              No public events yet. Create one and it will appear here.
            </div>
          )}
          {rows.map(({ event, playerCount }) => (
            <div key={event.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[16px] font-bold">{event.name}</h2>
                    <span className={`pill ${STATUS_STYLE[event.status]}`}>
                      {event.status === "IN_PROGRESS" && <LiveDot />} {STATUS_LABEL[event.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-ink/55">
                    {formatEventDate(event.date)} · {event.startTime} · {event.courseName ?? "Course TBC"}
                  </p>
                  {event.description && <p className="mt-1.5 line-clamp-2 text-[13px] text-ink/50">{event.description}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2 text-[12px]">
                    <span className="pill bg-ink/[0.04] text-ink/60 ring-ink/10">{Number(playerCount)} entered</span>
                    <span className="pill bg-ink/[0.04] text-ink/60 ring-ink/10">{event.format === "STABLEFORD" ? "Stableford" : "Stroke play"}</span>
                    <span className="pill bg-ink/[0.04] text-ink/60 ring-ink/10">{event.handicapAllowance}% allowance</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Link href={`/events/${event.slug}`} className="btn-secondary btn-sm">Open</Link>
                  <Link href={`/live/${event.slug}`} className="btn-ghost btn-sm">Leaderboard</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <JoinByCode />
          <div className="card card-pad">
            <h2 className="text-[15px] font-bold">How entries work</h2>
            <ul className="mt-2 space-y-2 text-[13px] text-ink/60">
              <li>· The organiser can register you directly, or share a join code.</li>
              <li>· You can only be in one event on any given date.</li>
              <li>· Tee groups are published by the organiser - you can set your own group if the organiser allows it.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
