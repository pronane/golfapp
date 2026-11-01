"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatEventDate } from "@/lib/format";

type Fixture = {
  id: string;
  slug: string;
  name: string;
  date: string;
  courseName: string | null;
  status: string;
  /** Dated outside the season: listed, but it cannot score. */
  outside?: boolean;
};

/**
 * Which golf days count towards a season. Managers pick from the days they run;
 * the season table recalculates on the next load.
 */
export function SeasonFixtures({ seasonId, fixtures, canManage }: { seasonId: string; fixtures: Fixture[]; canManage: boolean }) {
  const router = useRouter();
  const [list, setList] = useState<Fixture[]>(fixtures);
  const [myEvents, setMyEvents] = useState<{ id: string; name: string; date: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadEvents = useCallback(async () => {
    if (loaded) return;
    setLoaded(true);
    const res = await fetch("/api/events?scope=admin", { cache: "no-store" });
    const data = await res.json().catch(() => ({ events: [] }));
    setMyEvents(
      (data.events ?? []).map((row: { event?: { id: string; name: string; date: string } } & { id?: string; name?: string; date?: string }) => {
        const event = row.event ?? (row as { id: string; name: string; date: string });
        return { id: event.id, name: event.name, date: event.date };
      }),
    );
  }, [loaded]);

  useEffect(() => {
    if (canManage) void loadEvents();
  }, [canManage, loadEvents]);

  async function add() {
    if (!selected) return;
    setBusy("add");
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: selected }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't add that golf day");
    else {
      setList(
        (data.fixtures ?? []).map((e: { id: string; slug: string; name: string; date: string; courseName: string | null; status: string }) => ({
          id: e.id,
          slug: e.slug,
          name: e.name,
          date: e.date,
          courseName: e.courseName,
          status: e.status,
        })),
      );
      // The list comes back from the API without the season window, so the
      // next full render (router.refresh) re-derives the warning.
      setSelected("");
      router.refresh();
    }
    setBusy(null);
  }

  async function remove(eventId: string) {
    setBusy(eventId);
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/events`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't remove that golf day");
    else {
      setList((prev) => prev.filter((f) => f.id !== eventId));
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-ink/[0.06] px-5 py-3.5">
        <h2 className="text-[15px] font-bold">Fixtures</h2>
        <p className="text-[12.5px] text-ink/50">Only the golf days listed here count towards the table.</p>
      </div>
      <ul className="divide-y divide-ink/[0.06]">
        {list.map((fixture) => (
          <li key={fixture.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="w-24 shrink-0 font-mono text-[12px] text-ink/50">{formatEventDate(fixture.date)}</div>
            <div className="min-w-0 flex-1">
              <Link href={`/events/${fixture.slug}`} className="truncate text-[14px] font-semibold hover:text-fairway-800">
                {fixture.name}
              </Link>
              <div className="text-[11.5px] text-ink/45">
                {fixture.courseName ?? "Course TBC"} · {fixture.status.toLowerCase().replace(/_/g, " ")}
                {fixture.outside ? " · outside the season, so it does not score" : ""}
              </div>
            </div>
            <Link href={`/live/${fixture.slug}`} className="text-[12px] font-semibold text-fairway-700 hover:underline">
              Board
            </Link>
            {canManage && (
              <button
                className="text-[12px] font-semibold text-ink/40 hover:text-rose-700"
                disabled={busy === fixture.id}
                onClick={() => void remove(fixture.id)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-5 py-8 text-center text-[13px] text-ink/50">
            No fixtures attached yet.{canManage ? " Add one below." : ""}
          </li>
        )}
      </ul>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-ink/[0.06] px-5 py-4">
          <div className="min-w-[240px] flex-1">
            <label className="label" htmlFor="season-fixture">Count one of your golf days</label>
            <select id="season-fixture" className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a golf day</option>
              {myEvents
                .filter((event) => !list.some((f) => f.id === event.id))
                .map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.date} · {event.name}
                  </option>
                ))}
            </select>
          </div>
          <button className="btn-secondary btn-sm" disabled={!selected || busy !== null} onClick={() => void add()}>
            {busy === "add" ? "Adding…" : "Add fixture"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </section>
  );
}
