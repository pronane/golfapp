import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listEventsForAdmin, STATUS_LABEL, STATUS_STYLE } from "@/lib/events";
import { formatEventDate } from "@/lib/format";
import { LiveDot } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  const rows = await listEventsForAdmin(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-fairway-700/70">Organiser</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Your golf days</h1>
          <p className="mt-1 text-[14px] text-ink/55">Create an event, publish groups, hand out scorecards and watch it come in.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/courses" className="btn-secondary btn-sm">Course library</Link>
          <Link href="/admin/events/new" className="btn-primary btn-sm">New golf day</Link>
        </div>
      </div>

      <div className="grid gap-3">
        {rows.length === 0 && (
          <div className="card card-pad text-center">
            <p className="text-[14px] text-ink/60">No events yet.</p>
            <Link href="/admin/events/new" className="btn-primary btn-sm mt-3">Create your first golf day</Link>
          </div>
        )}
        {rows.map(({ event, role }) => (
          <div key={event.id} className="card flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold">{event.name}</span>
                <span className={`pill ${STATUS_STYLE[event.status]}`}>{event.status === "IN_PROGRESS" && <LiveDot />} {STATUS_LABEL[event.status]}</span>
                <span className="pill bg-ink/[0.04] text-ink/55 ring-ink/10">{role.toLowerCase()}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink/50">
                {formatEventDate(event.date)} · {event.startTime} · {event.courseName ?? "Course TBC"} · join code <span className="font-mono font-semibold text-ink/70">{event.joinCode}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/live/${event.slug}`} className="btn-ghost btn-sm">Leaderboard</Link>
              <Link href={`/admin/events/${event.id}`} className="btn-primary btn-sm">Manage</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
