"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BLANK_CARD, CourseCardEditor, type CardHole } from "./CourseCardEditor";
import { CopyButton } from "./CopyButton";
import { GamesConsole } from "./GamesConsole";
import { PaymentsPanel } from "./PaymentsPanel";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/status";

export type ConsoleEvent = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  date: string;
  startTime: string;
  courseId: string | null;
  courseName: string | null;
  format: string;
  handicapAllowance: number;
  status: string;
  maxPlayers: number;
  joinCode: string;
  isPublic: boolean;
};

export type ConsoleRegistration = {
  player: {
    id: string;
    name: string;
    email: string | null;
    handicapIndex: number;
    homeClub: string | null;
    golfEnglandId: string | null;
    claimCode: string;
    userId: string | null;
  };
  registration: {
    id: string;
    groupId: string | null;
    tee: string;
    playingHandicap: number;
    courseHandicap: number;
    status: string;
  };
};

export type ConsoleGroup = { id: string; name: string; teeTime: string | null; token: string };
export type ConsoleAdmin = { id: string; userId: string; name: string; email: string; role: string };

type Props = {
  event: ConsoleEvent;
  holes: CardHole[];
  registrations: ConsoleRegistration[];
  groups: ConsoleGroup[];
  admins: ConsoleAdmin[];
  isOwner: boolean;
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "field", label: "Field" },
  { id: "groups", label: "Groups" },
  { id: "card", label: "Card" },
  { id: "games", label: "Games" },
  { id: "payments", label: "Payments" },
  { id: "admins", label: "Admins" },
] as const;

export function EventConsole(props: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: props.event.name,
    description: props.event.description ?? "",
    date: props.event.date,
    startTime: props.event.startTime,
    format: props.event.format,
    handicapAllowance: props.event.handicapAllowance,
    maxPlayers: props.event.maxPlayers,
    isPublic: props.event.isPublic,
    courseId: props.event.courseId ?? "",
  });
  const [holes, setHoles] = useState<CardHole[]>(props.holes.length ? props.holes : BLANK_CARD);
  const [courses, setCourses] = useState<{ id: string; name: string; club: string | null }[]>([]);
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerResults, setPlayerResults] = useState<
    { id: string; name: string; handicapIndex: number; homeClub: string | null; hasAccount: boolean }[]
  >([]);
  const [guest, setGuest] = useState({ name: "", handicapIndex: "", homeClub: "", golfEnglandId: "" });
  const [csv, setCsv] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminRole, setAdminRole] = useState<"ADMIN" | "SCORER">("ADMIN");
  const [groupSize, setGroupSize] = useState(4);

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((data) => setCourses(data.courses ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab !== "field") return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/players?q=${encodeURIComponent(playerQuery)}`);
      const data = await res.json();
      setPlayerResults(data.players ?? []);
    }, 220);
    return () => clearTimeout(timer);
  }, [playerQuery, tab, props.registrations.length]);

  function flash(message: string) {
    setToast(message);
    setError(null);
    window.setTimeout(() => setToast(null), 2500);
  }

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      router.refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const registeredIds = new Set(props.registrations.map((r) => r.player.id));
  const unassigned = props.registrations.filter((r) => !r.registration.groupId).length;

  return (
    <div className="space-y-5">
      <header className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 bg-fairway-950 px-5 py-5 text-white">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`pill ${STATUS_STYLE[props.event.status]}`}>{STATUS_LABEL[props.event.status]}</span>
              <span className="pill bg-white/10 text-white/75 ring-white/15">{props.registrations.length} entered</span>
              <span className="pill bg-white/10 text-white/75 ring-white/15">{props.groups.length} groups</span>
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{props.event.name}</h1>
            <p className="text-[13px] text-fairway-100/65">
              {props.event.courseName ?? "Course TBC"} · {props.event.date} · first tee {props.event.startTime}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/events/${props.event.slug}`} className="btn bg-white/10 btn-sm text-white ring-1 ring-inset ring-white/20 hover:bg-white/15">Event page</Link>
            <Link href={`/live/${props.event.slug}`} className="btn-sand btn-sm">Live board</Link>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-ink/[0.06] px-3 py-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${tab === item.id ? "bg-fairway-700 text-white" : "text-ink/60 hover:bg-ink/[0.05]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {(toast || error) && (
        <div className={`rounded-xl px-4 py-2.5 text-[13px] font-medium ${error ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"}`}>
          {error ?? toast}
        </div>
      )}

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <section className="card card-pad space-y-3">
            <h2 className="text-[15px] font-bold">Event details</h2>
            <div>
              <label className="label" htmlFor="ev-name">Name</label>
              <input id="ev-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="ev-desc">Description</label>
              <textarea id="ev-desc" rows={2} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="ev-date">Date</label>
                <input id="ev-date" type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="ev-time">First tee</label>
                <input id="ev-time" type="time" className="input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="ev-max">Max players</label>
                <input id="ev-max" type="number" className="input" value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="ev-course">Course</label>
                <select id="ev-course" className="select" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
                  <option value="">Course TBC</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}{course.club ? ` · ${course.club}` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ev-format">Format</label>
                <select id="ev-format" className="select" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="STABLEFORD">Stableford</option>
                  <option value="STROKE_PLAY">Net stroke play</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="ev-allowance">Allowance %</label>
                <input id="ev-allowance" type="number" min={0} max={100} className="input" value={form.handicapAllowance} onChange={(e) => setForm({ ...form, handicapAllowance: Number(e.target.value) })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" className="h-4 w-4 rounded accent-fairway-700" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
              Public event (visible on the site and to spectators)
            </label>
            <div className="flex justify-end">
              <button
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={async () => {
                  const result = await call(`/api/events/${props.event.id}`, "PATCH", {
                    ...form,
                    description: form.description || null,
                    courseId: form.courseId || null,
                  });
                  if (result) flash("Event updated");
                }}
              >
                Save changes
              </button>
            </div>
          </section>

          <div className="space-y-4">
            <section className="card card-pad">
              <h2 className="text-[15px] font-bold">Run the day</h2>
              <p className="mt-1 text-[12.5px] text-ink/55">Status controls what players and spectators can do.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["OPEN", "IN_PROGRESS", "COMPLETED", "DRAFT"] as const).map((status) => (
                  <button
                    key={status}
                    className={`rounded-xl px-3 py-2 text-[12.5px] font-semibold transition ${props.event.status === status ? "bg-fairway-700 text-white" : "bg-ink/[0.04] text-ink/60 hover:bg-ink/[0.07]"}`}
                    disabled={busy}
                    onClick={async () => {
                      const ok = await call(`/api/events/${props.event.id}`, "PATCH", { status });
                      if (ok) flash(`Status set to ${STATUS_LABEL[status]}`);
                    }}
                  >
                    {STATUS_LABEL[status]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-ink/45">Completed events lock scoring. Draft events are hidden from the public list.</p>
            </section>

            <section className="card card-pad">
              <h2 className="text-[15px] font-bold">Share</h2>
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 rounded-xl bg-ink/[0.03] px-3 py-2">
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/40">Join code</div>
                    <div className="font-mono text-[15px] font-bold tracking-[0.18em]">{props.event.joinCode}</div>
                  </div>
                  <CopyButton value={props.event.joinCode} label="Copy code" />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-ink/[0.03] px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/40">Leaderboard</div>
                    <div className="truncate text-[12.5px] font-medium">/live/{props.event.slug}</div>
                  </div>
                  <CopyButton value={`/live/${props.event.slug}`} />
                </div>
                <a href={`/api/events/${props.event.id}/export`} className="btn-secondary btn-sm w-full">Download results CSV</a>
              </div>
            </section>

            {props.isOwner && (
              <section className="card card-pad">
                <h2 className="text-[15px] font-bold text-rose-700">Danger zone</h2>
                <p className="mt-1 text-[12.5px] text-ink/55">Deleting removes entries, groups and every score.</p>
                <button
                  className="btn-danger btn-sm mt-3"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("Delete this event and all of its scores?")) return;
                    const result = await call(`/api/events/${props.event.id}`, "DELETE");
                    if (result) router.push("/admin");
                  }}
                >
                  Delete event
                </button>
              </section>
            )}
          </div>
        </div>
      )}

      {tab === "field" && (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3">
              <h2 className="text-[15px] font-bold">The field</h2>
              <span className="text-[12px] text-ink/45">{props.registrations.length} players · {unassigned} ungrouped</span>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="text-center">HCP</th>
                  <th className="text-center">PH</th>
                  <th>Group</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {props.registrations.map(({ player, registration }) => (
                  <tr key={player.id}>
                    <td>
                      <div className="font-semibold">{player.name}</div>
                      <div className="text-[11.5px] text-ink/45">
                        {player.homeClub ?? "No club"} · {player.golfEnglandId ?? "no GE id"} · claim {player.claimCode}
                      </div>
                    </td>
                    <td className="text-center font-mono text-[12.5px]">{player.handicapIndex.toFixed(1)}</td>
                    <td className="text-center font-mono text-[12.5px] font-bold">{registration.playingHandicap}</td>
                    <td>
                      <select
                        className="select px-2 py-1 text-[12px]"
                        value={registration.groupId ?? ""}
                        disabled={busy}
                        onChange={async (e) => {
                          const value = e.target.value;
                          if (value) {
                            await call(`/api/events/${props.event.id}/groups/${value}`, "POST", { playerId: player.id, action: "add" });
                          } else if (registration.groupId) {
                            await call(`/api/events/${props.event.id}/groups/${registration.groupId}`, "POST", { playerId: player.id, action: "remove" });
                          }
                        }}
                      >
                        <option value="">Unassigned</option>
                        {props.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </td>
                    <td className="text-right">
                      <button
                        className="text-[12px] font-semibold text-rose-600 hover:underline"
                        disabled={busy}
                        onClick={() => call(`/api/events/${props.event.id}/players/${player.id}`, "DELETE")}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {props.registrations.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[13px] text-ink/45">Nobody registered yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <div className="space-y-4">
            <section className="card card-pad">
              <h2 className="text-[15px] font-bold">Add a player</h2>
              <input className="input mt-2" placeholder="Search existing players by name, club or GE ID" value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} />
              <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                {playerResults
                  .filter((p) => !registeredIds.has(p.id))
                  .map((player) => (
                    <li key={player.id} className="flex items-center gap-2 rounded-lg bg-ink/[0.03] px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{player.name}</div>
                        <div className="text-[11px] text-ink/45">HI {player.handicapIndex.toFixed(1)} · {player.homeClub ?? "—"} {player.hasAccount ? "· has login" : ""}</div>
                      </div>
                      <button
                        className="btn-primary btn-sm"
                        disabled={busy}
                        onClick={async () => {
                          const result = await call(`/api/events/${props.event.id}/players`, "POST", { playerId: player.id });
                          if (result) flash(`${player.name} added`);
                        }}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                {playerResults.filter((p) => !registeredIds.has(p.id)).length === 0 && (
                  <li className="px-1 py-2 text-[12.5px] text-ink/45">No matches. Create a guest player below.</li>
                )}
              </ul>
            </section>

            <section className="card card-pad">
              <h2 className="text-[15px] font-bold">New guest player</h2>
              <p className="text-[12px] text-ink/50">No account needed - they can claim the entry later with the claim code.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className="input col-span-2" placeholder="Full name" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
                <input className="input" placeholder="Handicap index" value={guest.handicapIndex} onChange={(e) => setGuest({ ...guest, handicapIndex: e.target.value })} />
                <input className="input" placeholder="Club" value={guest.homeClub} onChange={(e) => setGuest({ ...guest, homeClub: e.target.value })} />
                <input className="input col-span-2" placeholder="Golf England ID (optional)" value={guest.golfEnglandId} onChange={(e) => setGuest({ ...guest, golfEnglandId: e.target.value })} />
              </div>
              <button
                className="btn-primary btn-sm mt-2 w-full"
                disabled={busy || guest.name.trim().length < 2}
                onClick={async () => {
                  const created = await call("/api/players", "POST", {
                    name: guest.name,
                    handicapIndex: guest.handicapIndex ? Number(guest.handicapIndex) : 0,
                    homeClub: guest.homeClub || undefined,
                    golfEnglandId: guest.golfEnglandId || undefined,
                  });
                  if (created?.player) {
                    await call(`/api/events/${props.event.id}/players`, "POST", { playerId: created.player.id });
                    flash(`${created.player.name} created and entered`);
                    setGuest({ name: "", handicapIndex: "", homeClub: "", golfEnglandId: "" });
                  }
                }}
              >
                Create and enter
              </button>
            </section>

            <section className="card card-pad">
              <h2 className="text-[15px] font-bold">Import a CSV</h2>
              <p className="text-[12px] text-ink/50">Columns: name, handicap, club, golf england id, email. One row per player.</p>
              <textarea
                className="input mt-2 font-mono text-[11.5px]"
                rows={4}
                placeholder={"name,handicap,club\nJane Smith,12.3,Harrow GC"}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
              />
              <button
                className="btn-secondary btn-sm mt-2 w-full"
                disabled={busy || csv.trim().length < 5}
                onClick={async () => {
                  const res = await fetch("/api/players/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ csv, eventId: props.event.id }),
                  });
                  const data = await res.json();
                  if (!res.ok) { setError(data.error ?? "Import failed"); return; }
                  setCsv("");
                  flash(`${data.created} created, ${data.updated} updated, ${data.registered ?? 0} entered`);
                  router.refresh();
                }}
              >
                Import and enter players
              </button>
            </section>
          </div>
        </div>
      )}

      {tab === "groups" && (
        <div className="space-y-4">
          <section className="card card-pad">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold">Tee groups</h2>
                <p className="text-[12.5px] text-ink/55">Each group gets its own private scorecard link - print it, WhatsApp it or turn it into a QR code.</p>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-[12px] text-ink/50">
                  Size
                  <select className="select ml-1 w-16 px-2 py-1" value={groupSize} onChange={(e) => setGroupSize(Number(e.target.value))}>
                    {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button
                  className="btn-primary btn-sm"
                  disabled={busy || props.registrations.length === 0}
                  onClick={async () => {
                    const result = await call(`/api/events/${props.event.id}/auto-groups`, "POST", { size: groupSize });
                    if (result) flash("Groups created and players allocated");
                  }}
                >
                  Auto-allocate
                </button>
                <button
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    const result = await call(`/api/events/${props.event.id}/groups`, "POST", {});
                    if (result) flash("Group added");
                  }}
                >
                  Add group
                </button>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            {props.groups.map((group) => {
              const members = props.registrations.filter((r) => r.registration.groupId === group.id);
              return (
                <section key={group.id} className="card card-pad">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-[15px] font-bold">{group.name}</h3>
                      <p className="text-[12px] text-ink/50">{members.length} players · tee {group.teeTime ?? "TBC"}</p>
                    </div>
                    <button
                      className="text-[12px] font-semibold text-rose-600 hover:underline"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(`Delete ${group.name}?`)) return;
                        await call(`/api/events/${props.event.id}/groups/${group.id}`, "DELETE");
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {members.map(({ player, registration }) => (
                      <li key={player.id} className="flex items-center justify-between text-[12.5px]">
                        <span className="font-medium">{player.name}</span>
                        <span className="text-ink/45">PH {registration.playingHandicap}</span>
                      </li>
                    ))}
                    {members.length === 0 && <li className="text-[12.5px] text-ink/40">Empty group</li>}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/score/${group.token}`} className="btn-secondary btn-sm">Open scorecard</Link>
                    <CopyButton value={`/score/${group.token}`} />
                  </div>
                  <p className="mt-2 truncate font-mono text-[10.5px] text-ink/35">/score/{group.token}</p>
                </section>
              );
            })}
            {props.groups.length === 0 && (
              <div className="card card-pad text-center text-[13px] text-ink/50 sm:col-span-2">
                No groups yet - use auto-allocate once players are entered.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "card" && (
        <section className="card card-pad space-y-4">
          <div>
            <h2 className="text-[15px] font-bold">The card for the day</h2>
            <p className="text-[12.5px] text-ink/55">
              Event admins can correct par and stroke index here without touching the course library - the day keeps its own snapshot.
            </p>
          </div>
          <CourseCardEditor holes={holes} onChange={setHoles} disabled={busy} />
          <div className="flex flex-wrap justify-between gap-2">
            <p className="text-[11.5px] text-ink/45">Course: {props.event.courseName ?? "none selected"}</p>
            <button
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={async () => {
                const result = await call(`/api/events/${props.event.id}/holes`, "PUT", { holes });
                if (result) flash("Card updated");
              }}
            >
              Save card
            </button>
          </div>
        </section>
      )}

      {tab === "games" && (
        <GamesConsole
          eventId={props.event.id}
          holeCount={holes.length || 18}
          players={props.registrations
            .filter((r) => r.registration.status === "REGISTERED")
            .map((r) => ({
              id: r.player.id,
              name: r.player.name,
              playingHandicap: r.registration.playingHandicap,
              groupId: r.registration.groupId,
            }))}
        />
      )}

      {tab === "payments" && <PaymentsPanel eventId={props.event.id} />}

      {tab === "admins" && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="card overflow-hidden">
            <div className="border-b border-ink/[0.06] px-5 py-3">
              <h2 className="text-[15px] font-bold">Event admins</h2>
              <p className="text-[12px] text-ink/50">Admins can edit the event and card; scorers can only input scores.</p>
            </div>
            <ul className="divide-y divide-ink/[0.06]">
              {props.admins.map((admin) => (
                <li key={admin.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold">{admin.name}</div>
                    <div className="truncate text-[11.5px] text-ink/45">{admin.email}</div>
                  </div>
                  <span className="pill bg-ink/[0.04] text-ink/55 ring-ink/10">{admin.role.toLowerCase()}</span>
                  {admin.role !== "OWNER" && (
                    <button
                      className="text-[12px] font-semibold text-rose-600 hover:underline"
                      disabled={busy}
                      onClick={() => call(`/api/events/${props.event.id}/admins/${admin.userId}`, "DELETE")}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="card card-pad">
            <h2 className="text-[15px] font-bold">Add an admin</h2>
            <p className="mt-1 text-[12px] text-ink/50">They need a GolfDay account first.</p>
            <input className="input mt-2" placeholder="their@email.co.uk" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            <select className="select mt-2" value={adminRole} onChange={(e) => setAdminRole(e.target.value as "ADMIN" | "SCORER")}>
              <option value="ADMIN">Admin - can edit the day</option>
              <option value="SCORER">Scorer - scores only</option>
            </select>
            <button
              className="btn-primary btn-sm mt-2 w-full"
              disabled={busy || !adminEmail.includes("@")}
              onClick={async () => {
                const result = await call(`/api/events/${props.event.id}/admins`, "POST", { email: adminEmail, role: adminRole });
                if (result) { setAdminEmail(""); flash("Admin added"); }
              }}
            >
              Add admin
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
