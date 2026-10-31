"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LeaderboardPayload } from "@/lib/leaderboard";
import { formatEventDate, formatToPar, ordinal } from "@/lib/format";
import { LiveDot, Trophy } from "./Icons";
import { useLiveBoard } from "./useLiveBoard";

function relative(date: Date | null) {
  if (!date) return "waiting";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 3) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function LiveLeaderboard({ initial }: { initial: LeaderboardPayload }) {
  const { board, status, changed, lastUpdate } = useLiveBoard(initial.event.id, initial);
  const [, forceTick] = useState(0);
  const [showCards, setShowCards] = useState(false);
  const data = board ?? initial;

  // keep the "updated Xs ago" label ticking
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  const isStableford = data.event.format === "STABLEFORD";
  const started = data.standings.some((s) => s.thru > 0);

  return (
    <div className="space-y-4">
      <header className="overflow-hidden rounded-2xl bg-fairway-950 text-white shadow-card">
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fairway-100/60">
                {data.event.status === "IN_PROGRESS" ? (<><LiveDot /> Live leaderboard</>) : data.event.status === "COMPLETED" ? "Final result" : "Leaderboard"}
              </div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{data.event.name}</h1>
              <p className="mt-1 text-[13px] text-fairway-100/70">
                {data.event.courseName ?? "Course TBC"} · {formatEventDate(data.event.date)} · {data.event.startTime}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`pill ${status === "live" ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30" : status === "connecting" ? "bg-white/10 text-white/70 ring-white/15" : "bg-amber-400/15 text-amber-200 ring-amber-400/30"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-400" : status === "offline" ? "bg-amber-400" : "bg-white/50"}`} />
                {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting"}
              </span>
              <span className="text-[11.5px] text-fairway-100/50">updated {relative(lastUpdate)}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HeaderStat label="Players" value={String(data.stats.registered)} />
            <HeaderStat label="Holes scored" value={`${data.stats.scoresEntered}`} />
            <HeaderStat label="Format" value={isStableford ? "Stableford" : "Net stroke"} />
            <HeaderStat label="Allowance" value={`${data.event.handicapAllowance}%`} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-white/[0.04] px-5 py-2.5 text-[12px] text-fairway-100/70 sm:px-7">
          <span>Par {data.par}</span>
          <span className="text-white/20">|</span>
          <span>{data.holes.length} holes</span>
          <span className="text-white/20">|</span>
          <span>{data.stats.leader ? `Leader: ${data.stats.leader}` : "Awaiting first card"}</span>
          <button onClick={() => setShowCards((v) => !v)} className="ml-auto rounded-lg bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold text-white/80 hover:bg-white/15">
            {showCards ? "Hide cards" : "Show hole-by-hole"}
          </button>
        </div>
      </header>

      <div className="card overflow-hidden">
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
              {data.standings.map((s) => {
                const byHole = new Map(s.holeResults.map((r) => [r.holeNumber, r]));
                return (
                  <tr key={s.playerId} className="bg-ink/[0.02]">
                    <td className="whitespace-nowrap rounded-l-lg px-2 py-1 font-semibold">{s.playerName}</td>
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
                    <td className="rounded-r-lg px-2 text-right font-mono font-bold">{isStableford ? s.points : formatToPar(s.netToPar)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink/40">Cell colour = Stableford points: 4+ green, 3 fairway, 2 par, 1 or 0 red.</p>
        </div>
      )}

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
            {data.standings.filter((s) => s.thru > 0).slice(0, 5).map((s) => (
              <li key={s.playerId} className="flex items-center gap-3 rounded-xl bg-ink/[0.03] px-3 py-2">
                <span className="w-6 text-center font-mono text-[12px] font-bold text-ink/50">{ordinal(s.position)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{s.playerName}</div>
                  <div className="text-[11.5px] text-ink/45">thru {s.thru} · {formatToPar(s.toPar)} gross</div>
                </div>
                <span className="font-mono text-[15px] font-extrabold">{isStableford ? `${s.points} pts` : `${formatToPar(s.netToPar)} net`}</span>
              </li>
            ))}
            {!started && <li className="text-[13px] text-ink/45">Nothing scored yet.</li>}
          </ol>
        </div>
      </div>

      <p className="text-center text-[12px] text-ink/40">
        Refresh-free live board · <Link className="link" href={`/events/${data.event.slug}`}>event details</Link>
      </p>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-inset ring-white/10">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-fairway-100/50">{label}</div>
      <div className="text-[17px] font-extrabold leading-tight">{value}</div>
    </div>
  );
}
