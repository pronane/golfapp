"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LeaderboardPayload } from "@/lib/leaderboard";
import { formatEventDate, formatToPar, ordinal } from "@/lib/format";
import { GamesPanels, SponsorStrip } from "./GamesPanels";
import { LiveDot, Trophy } from "./Icons";
import { useLiveBoard } from "./useLiveBoard";

function relative(date: Date | null) {
  if (!date) return "waiting";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 3) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function LiveLeaderboard({ initial, tv = false }: { initial: LeaderboardPayload; tv?: boolean }) {
  const { board, status, changed, lastUpdate } = useLiveBoard(initial.event.id, initial);
  const [, forceTick] = useState(0);
  const [showCards, setShowCards] = useState(false);
  const data = board ?? initial;

  // keep the "updated Xs ago" label ticking
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  const scramble = data.event.format === "TEXAS_SCRAMBLE";
  const teams = data.teams ?? [];
  const isStableford = data.event.format === "STABLEFORD" || scramble;
  const started = scramble ? teams.some((t) => t.thru > 0) : data.standings.some((s) => s.thru > 0);

  if (tv) return <TvBoard data={data} changed={changed} live={status === "live"} />;

  return (
    <div className="space-y-4">
      <header className="hero overflow-hidden rounded-2xl shadow-card ring-1 ring-inset ring-fairway-200/70">
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fairway-700/70">
                {data.event.status === "IN_PROGRESS" ? (<><LiveDot /> Live leaderboard</>) : data.event.status === "COMPLETED" ? "Final result" : "Leaderboard"}
              </div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{data.event.name}</h1>
              <p className="mt-1 text-[13px] hero-muted">
                {data.event.courseName ?? "Course TBC"} · {formatEventDate(data.event.date)} · {data.event.startTime}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`pill ${status === "live" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : status === "connecting" ? "bg-white/70 text-fairway-800 ring-fairway-200" : "bg-amber-100 text-amber-800 ring-amber-300"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-500" : status === "offline" ? "bg-amber-500" : "bg-fairway-400"}`} />
                {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting"}
              </span>
              <span className="text-[11.5px] hero-muted">updated {relative(lastUpdate)}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HeaderStat label={scramble ? "Teams" : "Players"} value={scramble ? String(teams.length) : String(data.stats.registered)} />
            <HeaderStat label="Holes scored" value={`${data.stats.scoresEntered}`} />
            <HeaderStat label="Format" value={scramble ? "Texas scramble" : isStableford ? "Stableford" : "Net stroke"} />
            <HeaderStat label="Allowance" value={`${data.event.handicapAllowance}%`} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-fairway-200/60 bg-white/40 px-5 py-2.5 text-[12px] hero-muted sm:px-7">
          <span>Par {data.par}</span>
          <span className="text-fairway-800/25">|</span>
          <span>{data.holes.length} holes</span>
          <span className="text-fairway-800/25">|</span>
          <span>{data.stats.leader ? `Leader: ${data.stats.leader}` : "Awaiting first card"}</span>
          <button onClick={() => setShowCards((v) => !v)} className="ml-auto rounded-lg bg-white/70 px-2.5 py-1 text-[11.5px] font-semibold text-fairway-900 ring-1 ring-inset ring-fairway-200 hover:bg-white">
            {showCards ? "Hide cards" : "Show hole-by-hole"}
          </button>
        </div>
      </header>

      <div className="card overflow-hidden">
        {scramble ? (
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-12">Pos</th>
                <th>Team</th>
                <th className="hidden sm:table-cell">Players</th>
                <th className="text-center">Thru</th>
                <th className="text-center">Pts</th>
                <th className="hidden text-center sm:table-cell">Gross</th>
                <th className="text-center">To par</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const isMoved = changed.some((id) => team.members.some((m) => m.playerId === id));
                return (
                  <tr key={team.groupId} className={`${isMoved ? "score-flash" : ""} ${team.position <= 3 ? "bg-sand-50/60" : ""}`}>
                    <td className="font-mono text-[13px] font-bold text-ink/70">
                      {team.thru === 0 ? "–" : team.tied ? `T${team.position}` : team.position}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{team.groupName}</span>
                        {team.position === 1 && team.thru > 0 && <Trophy className="h-3.5 w-3.5 text-sand-500" />}
                        {isMoved && <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">updated</span>}
                      </div>
                      <div className="text-[11.5px] text-ink/45">
                        Team handicap {team.teamHandicap}
                        {team.teeTime ? ` · tee ${team.teeTime}` : ""}
                        {team.drivesShort.length > 0 && team.thru > 0
                          ? ` · drives owed: ${team.drivesShort.join(", ")}`
                          : ""}
                      </div>
                    </td>
                    <td className="hidden text-[13px] text-ink/55 sm:table-cell">
                      {team.members.map((m) => m.name).join(" · ")}
                    </td>
                    <td className="text-center font-mono text-[13px]">{team.thru === 0 ? "–" : team.thru === data.holes.length ? "F" : team.thru}</td>
                    <td className="text-center font-mono text-[15px] font-extrabold">{team.thru === 0 ? "–" : team.points}</td>
                    <td className="hidden text-center font-mono text-[13px] text-ink/60 sm:table-cell">{team.thru === 0 ? "–" : team.gross}</td>
                    <td className="text-center font-mono text-[13px] text-ink/60">{team.thru === 0 ? "–" : formatToPar(team.toPar)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-12">Pos</th>
              <th>Player</th>
              <th className="hidden sm:table-cell">Group</th>
              <th className="text-center">Thru</th>
              <th className="text-center">{isStableford ? "Pts" : "Net"}</th>
              <th className="hidden text-center sm:table-cell">Gross</th>
              <th className="text-center">To par</th>
            </tr>
          </thead>
          <tbody>
            {data.standings.map((s) => {
              const isMoved = changed.includes(s.playerId);
              return (
                <tr key={s.playerId} className={`${isMoved ? "score-flash" : ""} ${s.position <= 3 ? "bg-sand-50/60" : ""}`}>
                  <td className="font-mono text-[13px] font-bold text-ink/70">
                    {s.thru === 0 ? "–" : s.tied ? `T${s.position}` : s.position}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{s.playerName}</span>
                      {s.position === 1 && s.thru > 0 && <Trophy className="h-3.5 w-3.5 text-sand-500" />}
                      {isMoved && <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">updated</span>}
                    </div>
                    <div className="text-[11.5px] text-ink/45">
                      HI {s.handicapIndex.toFixed(1)} · PH {s.playingHandicap} · {s.tee}
                    </div>
                  </td>
                  <td className="hidden text-[13px] text-ink/55 sm:table-cell">{s.groupName ?? "—"}</td>
                  <td className="text-center font-mono text-[13px]">{s.thru === 0 ? "–" : s.thru === data.holes.length ? "F" : s.thru}</td>
                  <td className="text-center font-mono text-[15px] font-extrabold">{s.thru === 0 ? "–" : isStableford ? s.points : formatToPar(s.netToPar)}</td>
                  <td className="hidden text-center font-mono text-[13px] text-ink/60 sm:table-cell">{s.thru === 0 ? "–" : s.totalStrokes}</td>
                  <td className="text-center font-mono text-[13px] text-ink/60">{s.thru === 0 ? "–" : formatToPar(s.toPar)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
        {!started && (
          <div className="border-t border-ink/[0.06] px-5 py-8 text-center text-[13.5px] text-ink/50">
            No scores yet. Cards appear here the moment the first group tees off.
          </div>
        )}
      </div>

      {showCards && (
        <div className="card overflow-x-auto p-4">
          <table className="min-w-[900px] border-separate border-spacing-y-1 text-[12px]">
            <thead>
              <tr className="text-ink/45">
                <th className="px-2 text-left font-semibold">Player</th>
                {data.holes.map((h) => (
                  <th key={h.holeNumber} className="w-7 px-0.5 text-center font-semibold">
                    {h.holeNumber}
                    <div className="text-[10px] font-normal text-ink/35">P{h.par}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(scramble ? teams.map((t) => ({ key: t.groupId, name: t.groupName, results: t.holeResults, total: t.points })) : data.standings.map((s) => ({ key: s.playerId, name: s.playerName, results: s.holeResults, total: s.points }))).map((s) => {
                const byHole = new Map(s.results.map((r) => [r.holeNumber, r]));
                return (
                  <tr key={s.key} className="bg-ink/[0.02]">
                    <td className="whitespace-nowrap rounded-l-lg px-2 py-1 font-semibold">{s.name}</td>
                    {data.holes.map((h) => {
                      const r = byHole.get(h.holeNumber);
                      const tone = !r
                        ? "text-ink/25"
                        : r.points >= 4
                          ? "bg-emerald-100 text-emerald-800"
                          : r.points === 3
                            ? "bg-fairway-50 text-fairway-800"
                            : r.points === 2
                              ? "text-ink/60"
                              : "bg-rose-50 text-rose-700";
                      return (
                        <td key={h.holeNumber} className="px-0.5 py-1 text-center">
                          <span className={`inline-grid h-6 w-6 place-items-center rounded font-mono text-[11.5px] font-semibold ${tone}`}>
                            {r?.strokes ?? "·"}
                          </span>
                        </td>
                      );
                    })}
                    <td className="rounded-r-lg px-2 text-right font-mono font-bold">{isStableford ? s.total : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink/40">Cell colour = Stableford points: 4+ green, 3 fairway, 2 par, 1 or 0 red.</p>
        </div>
      )}

      <SponsorStrip games={data.games} />

      <GamesPanels games={data.games} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card card-pad">
          <h2 className="text-[15px] font-bold">Group sweep</h2>
          <p className="text-[12.5px] text-ink/50">Combined Stableford points per tee group.</p>
          <ul className="mt-3 space-y-2">
            {[...data.groups].sort((a, b) => b.points - a.points).map((g, index) => (
              <li key={g.id} className="flex items-center gap-3 rounded-xl bg-ink/[0.03] px-3 py-2">
                <span className="w-4 text-center font-mono text-[12px] font-bold text-ink/50">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{g.name} {g.teeTime && <span className="font-normal text-ink/40">· {g.teeTime}</span>}</div>
                  <div className="truncate text-[11.5px] text-ink/45">{g.players.join(" · ")}</div>
                </div>
                <span className="font-mono text-[15px] font-extrabold">{g.points}</span>
              </li>
            ))}
            {data.groups.length === 0 && <li className="text-[13px] text-ink/45">No groups yet.</li>}
          </ul>
        </div>

        <div className="card card-pad">
          <h2 className="text-[15px] font-bold">Card of the day</h2>
          <p className="text-[12.5px] text-ink/50">Best completed or in-progress rounds.</p>
          <ol className="mt-3 space-y-2">
            {(scramble
              ? teams.map((t) => ({ id: t.groupId, name: t.groupName, position: t.position, thru: t.thru, toPar: t.toPar, points: t.points }))
              : data.standings.map((s) => ({ id: s.playerId, name: s.playerName, position: s.position, thru: s.thru, toPar: s.toPar, points: s.points }))
            ).filter((s) => s.thru > 0).slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl bg-ink/[0.03] px-3 py-2">
                <span className="w-6 text-center font-mono text-[12px] font-bold text-ink/50">{ordinal(s.position)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{s.name}</div>
                  <div className="text-[11.5px] text-ink/45">thru {s.thru} · {formatToPar(s.toPar)} gross</div>
                </div>
                <span className="font-mono text-[15px] font-extrabold">{`${s.points} pts`}</span>
              </li>
            ))}
            {!started && <li className="text-[13px] text-ink/45">Nothing scored yet.</li>}
          </ol>
        </div>
      </div>

      <p className="text-center text-[12px] text-ink/40">
        Refresh-free live board · <Link className="link" href={`/events/${data.event.slug}`}>event details</Link> ·{" "}
        <Link className="link" href={`/live/${data.event.slug}?tv=1`}>clubhouse TV mode</Link>
      </p>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-inset ring-fairway-200/70">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-fairway-700/60">{label}</div>
      <div className="text-[17px] font-extrabold leading-tight">{value}</div>
    </div>
  );
}

/**
 * Full-screen clubhouse display: big type, the leaderboard scrolling slowly on
 * its own, side and team games alongside, sponsors along the bottom. Opened
 * with /live/<slug>?tv=1 on a TV or projector; no controls to touch.
 */
function TvBoard({ data, changed, live }: { data: LeaderboardPayload; changed: string[]; live: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState("");
  const scramble = data.event.format === "TEXAS_SCRAMBLE";
  const isStableford = data.event.format === "STABLEFORD" || scramble;
  const rows = scramble
    ? (data.teams ?? []).map((t) => ({
        key: t.groupId,
        name: t.groupName,
        sub: `Team handicap ${t.teamHandicap}`,
        thru: t.thru,
        points: t.points,
        netToPar: t.netToPar,
        position: t.position,
        tied: t.tied,
      }))
    : data.standings.map((s) => ({
        key: s.playerId,
        name: s.playerName,
        sub: `${s.groupName ?? ""} · PH ${s.playingHandicap}`,
        thru: s.thru,
        points: s.points,
        netToPar: s.netToPar,
        position: s.position,
        tied: s.tied,
      }));

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Slow continuous scroll; pause at the bottom, then jump back to the leaders.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let pauseUntil = Date.now() + 6000;
    const id = window.setInterval(() => {
      if (Date.now() < pauseUntil) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
        pauseUntil = Date.now() + 6000;
        window.setTimeout(() => el.scrollTo({ top: 0, behavior: "smooth" }), 4000);
        return;
      }
      el.scrollTop += 1;
    }, 40);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#fbfaf5] text-ink">
      <header className="flex items-center justify-between gap-6 border-b border-fairway-200/70 bg-white/60 px-8 py-5">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold uppercase tracking-[0.16em] text-fairway-700/70">
            {data.event.status === "IN_PROGRESS" && live ? (<><LiveDot /> Live</>) : data.event.status === "COMPLETED" ? "Final result" : "Leaderboard"}
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-fairway-950">{data.event.name}</h1>
        </div>
        <div className="text-right">
          <div className="font-mono text-4xl font-extrabold text-fairway-900">{clock}</div>
          <div className="text-[15px] text-fairway-800/70">
            {data.event.courseName ?? ""} · {scramble ? "Texas scramble" : isStableford ? "Stableford" : "Net stroke play"}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-6 px-8 py-6">
        <div ref={scroller} className="min-h-0 overflow-hidden rounded-2xl bg-white/70 ring-1 ring-inset ring-fairway-200/70">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-fairway-100/95 text-[14px] uppercase tracking-wide text-fairway-800/60">
              <tr>
                <th className="w-20 px-5 py-3">Pos</th>
                <th className="py-3">{scramble ? "Team" : "Player"}</th>
                <th className="w-24 py-3 text-center">Thru</th>
                <th className="w-28 py-3 pr-5 text-right">{isStableford ? "Points" : "Net"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} className={`border-t border-fairway-100 ${changed.includes(s.key) ? "score-flash" : ""}`}>
                  <td className="px-5 py-3 font-mono text-2xl font-bold text-fairway-800/70">
                    {s.thru === 0 ? "–" : s.tied ? `T${s.position}` : s.position}
                  </td>
                  <td className="py-3">
                    <div className="text-2xl font-bold text-fairway-950">{s.name}</div>
                    <div className="text-[14px] text-fairway-800/60">{s.sub}</div>
                  </td>
                  <td className="py-3 text-center font-mono text-2xl">{s.thru === 0 ? "–" : s.thru === data.holes.length ? "F" : s.thru}</td>
                  <td className="py-3 pr-5 text-right font-mono text-3xl font-extrabold text-fairway-900">
                    {s.thru === 0 ? "–" : isStableford ? s.points : formatToPar(s.netToPar)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="min-h-0 space-y-4 overflow-hidden">
          <GamesPanels games={data.games} tv />
          {!data.games?.matchPlay && (
            <section className="rounded-2xl bg-white/70 p-5 ring-1 ring-inset ring-fairway-200/70">
              <h2 className="text-[15px] font-bold">Group sweep</h2>
              <ol className="mt-3 space-y-1.5">
                {[...data.groups].sort((a, b) => b.points - a.points).slice(0, 5).map((g, i) => (
                  <li key={g.id} className="flex items-center justify-between rounded-xl bg-fairway-50 px-3 py-2 text-[15px]">
                    <span><span className="mr-2 font-mono text-fairway-800/60">{i + 1}</span>{g.name}</span>
                    <span className="font-mono font-extrabold">{g.points}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>

      <footer className="border-t border-fairway-200/70 px-8 py-4">
        <SponsorStrip games={data.games} tv />
      </footer>
    </div>
  );
}
