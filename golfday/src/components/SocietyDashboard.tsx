"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatEventDate } from "@/lib/format";
import { CopyButton } from "./CopyButton";

type Society = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  homeClub: string | null;
  joinCode: string;
};

type Member = {
  playerId: string;
  name: string;
  handicapIndex: number;
  homeClub: string | null;
  role: string;
  status: string;
};

type Fixture = {
  id: string;
  slug: string;
  name: string;
  date: string;
  status: string;
  format: string;
  courseName: string | null;
};

type Season = {
  id: string;
  slug: string;
  name: string;
  startsOn: string;
  endsOn: string;
  scheme: string;
  bestOf: number;
};

type Props = {
  society: Society;
  members: Member[];
  fixtures: Fixture[];
  seasons: Season[];
  role: string | null;
  canManage: boolean;
  isMember: boolean;
};

const roleLabel = (role: string) => (role === "OWNER" ? "Owner" : role === "SECRETARY" ? "Secretary" : "Member");

const formatLabel = (format: string) =>
  format === "TEXAS_SCRAMBLE" ? "Texas scramble" : format === "STROKE_PLAY" ? "Net stroke play" : "Stableford";

export function SocietyDashboard({ society, members, fixtures, seasons, role, canManage }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [roster, setRoster] = useState<Member[]>(members);
  const [fixtureList, setFixtureList] = useState<Fixture[]>(fixtures);

  // "Add an existing golf day" picker
  const [myEvents, setMyEvents] = useState<{ id: string; name: string; date: string; slug: string }[]>([]);
  const [eventToAdd, setEventToAdd] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Handicap integration (owner / secretary only)
  const [integration, setIntegration] = useState<{
    source: "MANUAL" | "DIRECTORY" | "WHS" | "CDH";
    country: string;
    apiBase: string;
    username: string;
    hasSecret: boolean;
    hasClientToken: boolean;
    secretMask: string | null;
    updatedAt: string | null;
  } | null>(null);
  const [integrationForm, setIntegrationForm] = useState({
    source: "DIRECTORY" as "MANUAL" | "DIRECTORY" | "WHS" | "CDH",
    country: "eng",
    apiBase: "",
    username: "",
    secret: "",
    clientToken: "",
  });
  const [integrationDetail, setIntegrationDetail] = useState<string | null>(null);
  const [testId, setTestId] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  // Roster search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; handicapIndex: number; homeClub: string | null }[]>([]);

  // New season form
  const [seasonForm, setSeasonForm] = useState({
    name: `${new Date().getFullYear()} Order of Merit`,
    startsOn: `${new Date().getFullYear()}-01-01`,
    endsOn: `${new Date().getFullYear()}-12-31`,
    scheme: "POSITION",
    bestOf: 0,
  });

  const loadEvents = useCallback(async () => {
    if (myEvents.length > 0 || loadingEvents) return;
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/events?scope=admin", { cache: "no-store" });
      const data = await res.json().catch(() => ({ events: [] }));
      const rows = (data.events ?? []).map((row: { event?: { id: string; name: string; date: string; slug: string } } & { id?: string; name?: string; date?: string; slug?: string }) => {
        const event = row.event ?? (row as { id: string; name: string; date: string; slug: string });
        return { id: event.id, name: event.name, date: event.date, slug: event.slug };
      });
      setMyEvents(rows);
    } finally {
      setLoadingEvents(false);
    }
  }, [myEvents.length, loadingEvents]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const res = await fetch(`/api/players?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({ players: [] }));
      setResults(data.players ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function addFixture() {
    if (!eventToAdd) return;
    setBusy("fixture");
    setError(null);
    const res = await fetch(`/api/societies/${society.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: eventToAdd }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't add that golf day");
    else {
      setFixtureList(
        (data.fixtures ?? []).map((e: { id: string; slug: string; name: string; date: string; status: string; format: string; courseName: string | null }) => ({
          id: e.id,
          slug: e.slug,
          name: e.name,
          date: e.date,
          status: e.status,
          format: e.format,
          courseName: e.courseName,
        })),
      );
      setEventToAdd("");
      setNotice("Golf day added to the fixture list.");
      router.refresh();
    }
    setBusy(null);
  }

  async function removeFixture(eventId: string) {
    setBusy(eventId);
    setError(null);
    const res = await fetch(`/api/societies/${society.id}/events`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't remove that golf day");
    else {
      setFixtureList((prev) => prev.filter((f) => f.id !== eventId));
      router.refresh();
    }
    setBusy(null);
  }

  async function addMember(playerId: string, name: string) {
    setBusy(playerId);
    setError(null);
    const res = await fetch(`/api/societies/${society.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't add that player");
    else {
      setRoster(data.members ?? []);
      setQuery("");
      setResults([]);
      setNotice(`${name} is on the roster.`);
      router.refresh();
    }
    setBusy(null);
  }

  async function removeMember(playerId: string, name: string) {
    setBusy(playerId);
    setError(null);
    const res = await fetch(`/api/societies/${society.id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't remove that member");
    else {
      setRoster(data.members ?? []);
      setNotice(`${name} is off the roster.`);
      router.refresh();
    }
    setBusy(null);
  }

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/societies/${society.id}/integration`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data?.integration || cancelled) return;
      setIntegration(data.integration);
      setIntegrationForm((prev) => ({
        ...prev,
        source: data.integration.source,
        country: data.integration.country,
        apiBase: data.integration.apiBase,
        username: data.integration.username,
        secret: "",
        clientToken: "",
      }));
      setIntegrationDetail(data.provider?.detail ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, society.id]);

  async function saveIntegration(e: React.FormEvent) {
    e.preventDefault();
    setBusy("integration");
    setError(null);
    setTestResult(null);
    const res = await fetch(`/api/societies/${society.id}/integration`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: integrationForm.source,
        country: integrationForm.country,
        apiBase: integrationForm.apiBase,
        username: integrationForm.username,
        // Only send credentials that were actually typed, so a blank field
        // never wipes a saved key by accident.
        ...(integrationForm.secret ? { secret: integrationForm.secret } : {}),
        ...(integrationForm.clientToken ? { clientToken: integrationForm.clientToken } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't save those settings");
    else {
      setIntegration(data.integration);
      setIntegrationForm((prev) => ({ ...prev, secret: "", clientToken: "" }));
      setIntegrationDetail(data.provider?.detail ?? null);
      setNotice("Handicap settings saved.");
      router.refresh();
    }
    setBusy(null);
  }

  async function clearCredential(field: "secret" | "clientToken") {
    setBusy("integration");
    setError(null);
    const res = await fetch(`/api/societies/${society.id}/integration`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't clear that credential");
    else {
      setIntegration(data.integration);
      setIntegrationDetail(data.provider?.detail ?? null);
      setNotice("Credential removed.");
    }
    setBusy(null);
  }

  async function testIntegration() {
    if (!testId.trim()) return;
    setBusy("test");
    setTestResult(null);
    const res = await fetch(`/api/societies/${society.id}/integration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ golferId: testId.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setTestResult({ ok: Boolean(data.ok), detail: data.detail ?? data.error ?? "No answer from the provider" });
    setBusy(null);
  }

  async function createSeason(e: React.FormEvent) {
    e.preventDefault();
    setBusy("season");
    setError(null);
    const res = await fetch("/api/seasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: seasonForm.name,
        societyId: society.id,
        startsOn: seasonForm.startsOn,
        endsOn: seasonForm.endsOn,
        scheme: seasonForm.scheme,
        bestOf: Number(seasonForm.bestOf),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't create that season");
    else router.push(`/seasons/${data.season.slug}`);
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      <header className="overflow-hidden rounded-2xl bg-fairway-950 text-white shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-6 sm:px-7">
          <div>
            <Link href="/societies" className="text-[12px] font-semibold text-fairway-100/60 hover:text-white">
              ← Societies
            </Link>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{society.name}</h1>
            <p className="mt-1 text-[13px] text-fairway-100/70">
              {society.homeClub ?? "No home club"} · {roster.length} member{roster.length === 1 ? "" : "s"} · {fixtureList.length} fixture
              {fixtureList.length === 1 ? "" : "s"}
            </p>
            {society.description && <p className="mt-2 max-w-2xl text-[13px] text-fairway-100/70">{society.description}</p>}
          </div>
          <div className="space-y-2 text-right">
            {role && <span className="pill bg-white/10 text-white/80 ring-white/20">{roleLabel(role)}</span>}
            {canManage && (
              <div className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-fairway-100/50">Join code</div>
                <div className="mt-0.5 flex items-center justify-end gap-2">
                  <span className="font-mono text-[19px] font-extrabold tracking-[0.18em]">{society.joinCode}</span>
                  <CopyButton value={society.joinCode} label="Copy" />
                </div>
                <p className="mt-1 text-[11px] text-fairway-100/50">Share it with members to let them join.</p>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">Fixtures</h2>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/events/new?society=${society.id}`} className="btn-primary btn-sm">
                    New golf day
                  </Link>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      void loadEvents();
                      setEventToAdd((v) => (v ? "" : "picker"));
                    }}
                  >
                    Add existing
                  </button>
                </div>
              )}
            </div>

            {eventToAdd === "picker" && canManage && (
              <div className="flex flex-wrap items-end gap-2 border-b border-ink/[0.06] bg-ink/[0.02] px-5 py-3">
                <div className="min-w-[240px] flex-1">
                  <label className="label" htmlFor="add-fixture">One of your golf days</label>
                  <select id="add-fixture" className="select" value="" onChange={(e) => setEventToAdd(e.target.value)} disabled={loadingEvents}>
                    <option value="">{loadingEvents ? "Loading…" : "Choose a golf day"}</option>
                    {myEvents
                      .filter((event) => !fixtureList.some((f) => f.id === event.id))
                      .map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.date} · {event.name}
                        </option>
                      ))}
                  </select>
                </div>
                <button className="btn-secondary btn-sm" onClick={() => setEventToAdd("")}>Cancel</button>
              </div>
            )}

            <ul className="divide-y divide-ink/[0.06]">
              {fixtureList.map((fixture) => (
                <li key={fixture.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="w-24 shrink-0 font-mono text-[12px] text-ink/50">{formatEventDate(fixture.date)}</div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/events/${fixture.slug}`} className="truncate text-[14px] font-semibold hover:text-fairway-800">
                      {fixture.name}
                    </Link>
                    <div className="truncate text-[11.5px] text-ink/45">
                      {fixture.courseName ?? "Course TBC"} · {formatLabel(fixture.format)} · {fixture.status.toLowerCase().replace(/_/g, " ")}
                    </div>
                  </div>
                  <Link href={`/live/${fixture.slug}`} className="text-[12px] font-semibold text-fairway-700 hover:underline">
                    Board
                  </Link>
                  {canManage && (
                    <button
                      className="text-[12px] font-semibold text-ink/40 hover:text-rose-700"
                      disabled={busy === fixture.id}
                      onClick={() => void removeFixture(fixture.id)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
              {fixtureList.length === 0 && (
                <li className="px-5 py-8 text-center text-[13px] text-ink/50">
                  No fixtures yet.{canManage ? " Create a golf day from here and it lands on the list." : ""}
                </li>
              )}
            </ul>
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
              <h2 className="text-[15px] font-bold">Order of merit</h2>
              <span className="text-[12px] text-ink/45">{seasons.length}</span>
            </div>
            <ul className="divide-y divide-ink/[0.06]">
              {seasons.map((season) => (
                <li key={season.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/seasons/${season.slug}`} className="truncate text-[14px] font-semibold hover:text-fairway-800">
                      {season.name}
                    </Link>
                    <div className="text-[11.5px] text-ink/45">
                      {formatEventDate(season.startsOn)} – {formatEventDate(season.endsOn)} ·{" "}
                      {season.scheme === "STABLEFORD" ? "Stableford points" : "Order of merit points"}
                      {season.bestOf > 0 ? ` · best ${season.bestOf} count` : ""}
                    </div>
                  </div>
                  <Link href={`/seasons/${season.slug}`} className="text-[12px] font-semibold text-fairway-700 hover:underline">
                    Table
                  </Link>
                </li>
              ))}
              {seasons.length === 0 && <li className="px-5 py-8 text-center text-[13px] text-ink/50">No seasons yet.</li>}
            </ul>

            {canManage && (
              <form onSubmit={createSeason} className="space-y-3 border-t border-ink/[0.06] px-5 py-4">
                <h3 className="text-[13px] font-bold text-ink/70">Start a season</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="season-name">Name</label>
                    <input id="season-name" className="input" value={seasonForm.name} onChange={(e) => setSeasonForm({ ...seasonForm, name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="season-start">Starts</label>
                    <input id="season-start" type="date" className="input" value={seasonForm.startsOn} onChange={(e) => setSeasonForm({ ...seasonForm, startsOn: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="season-end">Ends</label>
                    <input id="season-end" type="date" className="input" value={seasonForm.endsOn} onChange={(e) => setSeasonForm({ ...seasonForm, endsOn: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label" htmlFor="season-scheme">Scoring</label>
                    <select id="season-scheme" className="select" value={seasonForm.scheme} onChange={(e) => setSeasonForm({ ...seasonForm, scheme: e.target.value })}>
                      <option value="POSITION">Positions (100-90-80…)</option>
                      <option value="STABLEFORD">Stableford points</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="season-best">Best N count (0 = all)</label>
                    <input id="season-best" type="number" min={0} max={40} className="input" value={seasonForm.bestOf} onChange={(e) => setSeasonForm({ ...seasonForm, bestOf: Number(e.target.value) })} />
                  </div>
                </div>
                <button className="btn-secondary w-full" disabled={busy !== null}>Create season</button>
              </form>
            )}
          </section>
        </div>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
            <h2 className="text-[15px] font-bold">Roster</h2>
            <span className="text-[12px] text-ink/45">{roster.length}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {roster.map((member) => (
              <li key={member.playerId} className="flex items-center gap-3 px-5 py-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-[11.5px] font-bold text-ink/60">
                  {member.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{member.name}</div>
                  <div className="text-[11px] text-ink/45">
                    HI {member.handicapIndex.toFixed(1)}
                    {member.homeClub ? ` · ${member.homeClub}` : ""}
                  </div>
                </div>
                <span className={`pill ${member.role === "MEMBER" ? "bg-ink/[0.04] text-ink/60 ring-ink/10" : "bg-fairway-50 text-fairway-800 ring-fairway-200"}`}>
                  {roleLabel(member.role)}
                </span>
                {canManage && member.role !== "OWNER" && (
                  <button
                    className="text-[11.5px] text-ink/35 hover:text-rose-700"
                    disabled={busy === member.playerId}
                    onClick={() => void removeMember(member.playerId, member.name)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {canManage && (
            <div className="space-y-2 border-t border-ink/[0.06] px-5 py-4">
              <h3 className="text-[13px] font-bold text-ink/70">Add a member</h3>
              <input
                className="input"
                placeholder="Search players by name, club or CDH id"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 && (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {results
                    .filter((player) => !roster.some((m) => m.playerId === player.id))
                    .map((player) => (
                      <li key={player.id} className="flex items-center gap-2 rounded-lg bg-ink/[0.03] px-2.5 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-semibold">{player.name}</div>
                          <div className="text-[11px] text-ink/45">HI {player.handicapIndex.toFixed(1)}</div>
                        </div>
                        <button
                          className="text-[11.5px] font-semibold text-fairway-700 hover:underline"
                          disabled={busy === player.id}
                          onClick={() => void addMember(player.id, player.name)}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {query && results.length === 0 && <p className="text-[12px] text-ink/45">No players match.</p>}
            </div>
          )}
        </section>

        {canManage && (
          <section className="card overflow-hidden lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.06] px-5 py-3.5">
              <div>
                <h2 className="text-[15px] font-bold">Handicaps</h2>
                <p className="text-[11.5px] text-ink/50">Where this club's handicap indexes come from.</p>
              </div>
              {integration && (
                <span className={`pill ${integration.source === "DIRECTORY" || integration.source === "MANUAL" ? "bg-ink/[0.04] text-ink/60 ring-ink/10" : "bg-fairway-50 text-fairway-800 ring-fairway-200"}`}>
                  {integration.source === "MANUAL" ? "Manual" : integration.source === "DIRECTORY" ? "Directory" : integration.source}
                </span>
              )}
            </div>

            <form onSubmit={saveIntegration} className="space-y-3 px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { value: "MANUAL" as const, label: "Typed in by hand", blurb: "No external lookups." },
                  { value: "DIRECTORY" as const, label: "GolfDay directory", blurb: "Players already here. No keys." },
                  { value: "WHS" as const, label: "National WHS database", blurb: "England, Scotland, Wales, Ireland." },
                  { value: "CDH" as const, label: "Our own CDH endpoint", blurb: "GET {base}/golfers/{id}." },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-[12.5px] ${
                      integrationForm.source === option.value ? "border-fairway-300 bg-fairway-50/60" : "border-ink/10 hover:bg-ink/[0.02]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="handicap-source"
                      className="mt-0.5"
                      value={option.value}
                      checked={integrationForm.source === option.value}
                      onChange={() => setIntegrationForm((prev) => ({ ...prev, source: option.value }))}
                    />
                    <span>
                      <span className="block font-semibold">{option.label}</span>
                      <span className="block text-[11px] text-ink/50">{option.blurb}</span>
                    </span>
                  </label>
                ))}
              </div>

              {(integrationForm.source === "WHS" || integrationForm.source === "CDH") && (
                <div className="grid gap-2 rounded-xl bg-ink/[0.02] p-3 sm:grid-cols-2">
                  {integrationForm.source === "WHS" && (
                    <div>
                      <label className="label" htmlFor="handicap-country">National union</label>
                      <select
                        id="handicap-country"
                        className="select"
                        value={integrationForm.country}
                        onChange={(e) => setIntegrationForm((prev) => ({ ...prev, country: e.target.value }))}
                      >
                        <option value="eng">England Golf</option>
                        <option value="sco">Scottish Golf</option>
                        <option value="wal">Wales Golf</option>
                        <option value="irl">Golf Ireland</option>
                      </select>
                    </div>
                  )}
                  <div className={integrationForm.source === "CDH" ? "sm:col-span-2" : ""}>
                    <label className="label" htmlFor="handicap-base">API base URL</label>
                    <input
                      id="handicap-base"
                      className="input font-mono text-[12px]"
                      placeholder={integrationForm.source === "WHS" ? "https://isvapi.whsplatform.englandgolf.org" : "https://handicaps.example.com/v1"}
                      value={integrationForm.apiBase}
                      onChange={(e) => setIntegrationForm((prev) => ({ ...prev, apiBase: e.target.value }))}
                    />
                    <p className="mt-1 text-[11px] text-ink/45">
                      {integrationForm.source === "WHS"
                        ? "Leave blank for the national platform."
                        : "Your endpoint must answer GET {base}/golfers/{id} with name and handicap."}
                    </p>
                  </div>
                  {integrationForm.source === "WHS" && (
                    <div>
                      <label className="label" htmlFor="handicap-user">Club username</label>
                      <input
                        id="handicap-user"
                        className="input"
                        value={integrationForm.username}
                        onChange={(e) => setIntegrationForm((prev) => ({ ...prev, username: e.target.value }))}
                        placeholder="club login from the union"
                        autoComplete="off"
                      />
                    </div>
                  )}
                  <div>
                    <label className="label" htmlFor="handicap-secret">
                      {integrationForm.source === "WHS" ? "Secret key" : "API key (optional)"}
                    </label>
                    <input
                      id="handicap-secret"
                      type="password"
                      className="input"
                      value={integrationForm.secret}
                      onChange={(e) => setIntegrationForm((prev) => ({ ...prev, secret: e.target.value }))}
                      placeholder={integration?.hasSecret ? integration.secretMask ?? "saved" : "not set"}
                      autoComplete="new-password"
                    />
                    <p className="mt-1 text-[11px] text-ink/45">
                      Stored encrypted. Leave blank to keep the saved key.
                      {integration?.hasSecret && (
                        <button type="button" className="ml-1 font-semibold text-rose-700 hover:underline" onClick={() => void clearCredential("secret")}>
                          Remove
                        </button>
                      )}
                    </p>
                  </div>
                  {integrationForm.source === "WHS" && (
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="handicap-token">Client token (JWT) - optional</label>
                      <input
                        id="handicap-token"
                        type="password"
                        className="input font-mono text-[12px]"
                        value={integrationForm.clientToken}
                        onChange={(e) => setIntegrationForm((prev) => ({ ...prev, clientToken: e.target.value }))}
                        placeholder={integration?.hasClientToken ? "saved" : "paste it if the union issued one"}
                        autoComplete="new-password"
                      />
                      <p className="mt-1 text-[11px] text-ink/45">
                        Used verbatim when present; otherwise GolfDay signs one with the username and secret.
                        {integration?.hasClientToken && (
                          <button type="button" className="ml-1 font-semibold text-rose-700 hover:underline" onClick={() => void clearCredential("clientToken")}>
                            Remove
                          </button>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {integrationDetail && <p className="text-[12px] text-ink/55">{integrationDetail}</p>}

              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="btn-primary btn-sm" disabled={busy === "integration"}>
                  {busy === "integration" ? "Saving…" : "Save handicap settings"}
                </button>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    className="input h-8 max-w-[190px] text-[12.5px]"
                    placeholder="CDH / member ID to test"
                    value={testId}
                    onChange={(e) => setTestId(e.target.value)}
                  />
                  <button type="button" className="btn-secondary btn-sm" disabled={busy === "test" || !testId.trim()} onClick={() => void testIntegration()}>
                    {busy === "test" ? "Testing…" : "Test lookup"}
                  </button>
                </div>
              </div>
              {testResult && (
                <p className={`rounded-lg px-3 py-2 text-[12.5px] ${testResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                  {testResult.detail}
                </p>
              )}
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
