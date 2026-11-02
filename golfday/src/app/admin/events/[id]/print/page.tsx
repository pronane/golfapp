import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEventBundle } from "@/lib/events";
import { getEventAccess } from "@/lib/http";
import { formatEventDate } from "@/lib/format";
import { formatLabel } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * Cart signs: one per tee group, each with a QR code that opens that group's
 * scorecard, so nobody types a 16-character link on a phone in the sun.
 *
 * Printed, not clicked: the page is plain black on white with no navigation,
 * because it is going through a clubhouse printer and onto a buggy.
 */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/admin/events/${id}/print`);
  const access = await getEventAccess(id, user);
  if (!access?.isAdmin) notFound();

  const bundle = await getEventBundle(id);
  if (!bundle) notFound();
  const { event, holes, registrations, groups } = bundle;
  const byGroup = new Map(groups.map((group) => [group.id, [] as { name: string; playingHandicap: number }[]]));
  for (const { registration, player } of registrations) {
    if (registration.status !== "REGISTERED") continue;
    if (!registration.groupId) continue;
    byGroup.get(registration.groupId)?.push({ name: player.name, playingHandicap: registration.playingHandicap });
  }

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 print:p-0">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/45">Admin · print</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{event.name} - cart signs</h1>
          <p className="text-[13px] text-ink/55">
            One card per tee group. Each QR opens that group&apos;s scorecard; no app, no sign-in.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/events/${id}`} className="btn-secondary btn-sm">Back to console</Link>
          <a href={`/api/events/${id}/export`} className="btn-ghost btn-sm">Results CSV</a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
        {groups.map((group) => {
          const players = byGroup.get(group.id) ?? [];
          return (
            <section key={group.id} className="break-inside-avoid rounded-xl border-2 border-black p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em]">{event.name}</p>
                  <h2 className="mt-0.5 text-xl font-extrabold leading-tight">{group.name}</h2>
                  <p className="text-[13px]">
                    {group.teeTime ? `Tee ${group.teeTime} · ` : ""}
                    {formatLabel(event.format)} · {event.handicapAllowance}% allowance
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/${id}/qr?group=${group.id}&cell=5`}
                  alt={`Scorecard QR for ${group.name}`}
                  width={116}
                  height={116}
                  className="h-[116px] w-[116px] shrink-0"
                />
              </div>
              <p className="mt-2 text-[13px] font-semibold">Scan to score - no app, no sign-in</p>
              <ul className="mt-1.5 grid grid-cols-2 gap-x-3 text-[12.5px]">
                {players.map((player) => (
                  <li key={player.name} className="truncate">
                    {player.name} <span className="text-black/50">· PH {player.playingHandicap}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-black/20 pt-1.5 text-[10.5px]">
                {event.courseName ?? "Course TBC"} · {formatEventDate(event.date)} · {holes.length} holes
              </p>
            </section>
          );
        })}
        {groups.length === 0 && (
          <p className="text-[13px] text-ink/55">No tee groups yet - allocate the four-balls first.</p>
        )}
      </div>

      <p className="mt-4 text-[11px] text-ink/45 print:mt-2">
        Join code for the whole field: <span className="font-mono font-bold">{event.joinCode}</span> · live board at
        /live/{event.slug}
      </p>
    </div>
  );
}
