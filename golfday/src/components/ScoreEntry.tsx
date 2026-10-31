"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { GroupScoreboard } from "@/lib/leaderboard";
import type { LeaderboardPayload } from "@/lib/leaderboard";
import { formatEventDate, formatToPar, ordinal } from "@/lib/format";
import { strokesReceived } from "@/lib/handicap";
import { stablefordPoints } from "@/lib/scoring";
import { LiveDot } from "./Icons";
import { useLiveBoard } from "./useLiveBoard";

type Props = {
  initial: GroupScoreboard;
  initialBoard: LeaderboardPayload | null;
};

const SCORE_WORDS: Record<number, string> = { 1: "Hole in one", 2: "Eagle", 3: "Birdie", 4: "Par", 5: "Bogey", 6: "Double", 7: "Triple", 8: "Blow-up" };

export function ScoreEntry({ initial, initialBoard }: Props) {
  const [card, setCard] = useState(initial);
  const [activePlayerId, setActivePlayerId] = useState(initial.players[0]?.id ?? "");
  const [activeHole, setActiveHole] = useState(() => {
    const first = initial.players[0];
    const firstMissing = initial.holes.find((h) => !first?.scores[h.holeNumber]);
    return firstMissing?.holeNumber ?? 1;
  });
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { board, status } = useLiveBoard(initial.event.id, initialBoard, true);
  const topFive = (board?.standings ?? initialBoard?.standings ?? []).filter((s) => s.thru > 0).slice(0, 5);

  const activePlayer = card.players.find((p) => p.id === activePlayerId) ?? card.players[0];
  const hole = card.holes.find((h) => h.holeNumber === activeHole) ?? card.holes[0];
  const received = hole && activePlayer ? strokesReceived(activePlayer.playingHandicap, hole.strokeIndex) : 0;
  const existing = activePlayer?.scores[activeHole];

  const scored = useMemo(() => card.players.reduce((sum, p) => sum + p.thru, 0), [card]);
  const totalHoles = card.players.length * card.holes.length;

  async function save(playerId: string, holeNumber: number, strokes: number) {
    setSaving(holeNumber);
    setError(null);
    const snapshot = card;
    // optimistic update
    setCard((prev) => ({
      ...prev,
      players: prev.players.map((p) =>
        p.id === playerId ? { ...p, scores: { ...p.scores, [holeNumber]: strokes } } : p,
      ),
    }));
    try {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: card.event.id, playerId, holeNumber, strokes, token: card.group.token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save that score");
      setFlash(`${playerId}-${holeNumber}`);
      window.setTimeout(() => setFlash(null), 1200);
      // refresh totals for the group from the authoritative endpoint
      const refreshed = await fetch(`/api/groups/${card.group.token}`, { cache: "no-store" });
      if (refreshed.ok) setCard(await refreshed.json());
      // move to the next unscored hole for this player
      const nextHole = card.holes.find(
        (h) => h.holeNumber !== holeNumber && !(card.players.find((p) => p.id === playerId)?.scores[h.holeNumber]),
      );
      if (nextHole && !card.players.find((p) => p.id === playerId)?.scores[nextHole.holeNumber]) {
        setActiveHole(nextHole.holeNumber);
      }
    } catch (err) {
      setCard(snapshot);
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  const parScores = hole ? [1, 2, 3, 4, 5, 6, 7, 8].map((strokes) => {
    const points = stablefordPoints(hole.par, strokes, received);
    const name = SCORE_WORDS[strokes - received - hole.par + 4] ?? "";
    return { strokes, points, name };
  }) : [];

  return (
    <div className="space-y-4">
      <header className="card sticky top-0 z-20 overflow-hidden">
        <div className="bg-fairway-950 px-5 py-3 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fairway-100/60">
                <LiveDot /> Live scorecard · {card.group.name}
              </div>
              <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">{card.event.name}</h1>
              <p className="text-[11.5px] text-fairway-100/60">
                {card.event.courseName} · {formatEventDate(card.event.date)} · tee {card.group.teeTime ?? "TBC"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="pill bg-white/10 text-white/80 ring-white/15">{scored}/{totalHoles} holes in</span>
              <Link href={`/live/${card.event.slug}`} className="btn bg-white/10 btn-sm text-white ring-1 ring-inset ring-white/20 hover:bg-white/15">
                Leaderboard
              </Link>
            </div>
          </div>
        </div>

        {/* player chips */}
        <div className="flex gap-2 overflow-x-auto px-4 py-2">
          {card.players.map((player) => {
            const isActive = player.id === activePlayer?.id;
            return (
              <button
                key={player.id}
                onClick={() => setActivePlayerId(player.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                  isActive ? "bg-fairway-700 text-white shadow-sm" : "bg-ink/[0.04] text-ink/70 hover:bg-ink/[0.07]"
                }`}
              >
                <div className={`grid h-6 w-6 place-items-center rounded-full text-[10.5px] font-bold ${isActive ? "bg-white/15" : "bg-white"}`}>
                  {player.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <div className="text-[13px] font-semibold leading-tight">{player.name.split(" ")[0]}</div>
                  <div className={`text-[10.5px] leading-tight ${isActive ? "text-white/70" : "text-ink/45"}`}>
                    {player.thru}h · {player.points} pts
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {/* hole strip */}
          <section className="card card-pad">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold">Holes</h2>
              <span className="text-[11.5px] text-ink/45">Tap a hole to score {activePlayer?.name.split(" ")[0]}</span>
            </div>
            <div className="mt-3 grid grid-cols-9 gap-1.5">
              {card.holes.map((h) => {
                const value = activePlayer?.scores[h.holeNumber];
                const isActive = h.holeNumber === hole?.holeNumber;
                const pts = value ? stablefordPoints(h.par, value, strokesReceived(activePlayer?.playingHandicap ?? 0, h.strokeIndex)) : null;
                return (
                  <button
                    key={h.holeNumber}
                    onClick={() => setActiveHole(h.holeNumber)}
                    className={`relative rounded-lg py-2 text-center transition ${
                      isActive
                        ? "bg-fairway-700 text-white ring-2 ring-fairway-700"
                        : value
                          ? "bg-fairway-50 text-fairway-900 ring-1 ring-inset ring-fairway-100"
                          : "bg-ink/[0.03] text-ink/50 ring-1 ring-inset ring-ink/[0.06] hover:bg-ink/[0.06]"
                    }`}
                  >
                    <div className="text-[10px] font-semibold opacity-60">{h.holeNumber}</div>
                    <div className="text-[14px] font-extrabold leading-tight">{value ?? "–"}</div>
                    <div className={`text-[9px] ${pts !== null && pts >= 3 && !isActive ? "font-bold text-emerald-700" : "opacity-50"}`}>
                      {pts !== null ? `${pts}p` : `P${h.par}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* score pad */}
          {hole && activePlayer && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.06] px-5 py-3">
                <div>
                  <h2 className="text-[15px] font-bold">Hole {hole.holeNumber}</h2>
                  <p className="text-[12.5px] text-ink/55">
                    Par {hole.par} · stroke index {hole.strokeIndex} · {activePlayer.name} receives{" "}
                    <span className="font-semibold text-ink/80">{received}</span> shot{received === 1 ? "" : "s"}
                  </p>
                </div>
                {existing != null && (
                  <span className="pill bg-amber-50 text-amber-700 ring-amber-200">Saved: {existing}</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 p-4 sm:grid-cols-8">
                {parScores.map(({ strokes, points, name }) => {
                  const selected = existing === strokes;
                  return (
                    <button
                      key={strokes}
                      onClick={() => save(activePlayer.id, hole.holeNumber, strokes)}
                      disabled={saving !== null}
                      className={`group relative rounded-xl px-1 py-3 text-center transition ${
                        selected
                          ? "bg-fairway-700 text-white ring-2 ring-fairway-700"
                          : points >= 4
                            ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                            : points === 3
                              ? "bg-fairway-50 ring-1 ring-inset ring-fairway-200 hover:bg-fairway-100"
                              : "bg-white ring-1 ring-inset ring-ink/10 hover:bg-ink/[0.04]"
                      } ${saving === hole.holeNumber ? "opacity-60" : ""}`}
                    >
                      <div className={`text-[19px] font-extrabold leading-none ${selected ? "" : "text-ink"}`}>{strokes}</div>
                      <div className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${selected ? "text-white/70" : points >= 4 ? "text-emerald-700" : "text-ink/40"}`}>
                        {name || `${strokes}`}
                      </div>
                      <div className={`text-[10px] font-bold ${selected ? "text-sand-300" : points >= 4 ? "text-emerald-700" : "text-ink/45"}`}>
                        {points} pt{points === 1 ? "" : "s"}
                      </div>
                    </button>
                  );
                })}
              </div>
              {existing != null && (
                <div className="border-t border-ink/[0.06] px-5 py-2.5 text-[12px] text-ink/50">
                  Tap a different number to correct hole {hole.holeNumber} - every change is written to the audit log.
                </div>
              )}
              {error && <div className="border-t border-rose-100 bg-rose-50 px-5 py-2.5 text-[12.5px] text-rose-700">{error}</div>}
              {flash && <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-2.5 text-[12.5px] font-medium text-emerald-700">Score saved - leaderboard updated.</div>}
            </section>
          )}

          {/* this group's players cards */}
          <section className="card overflow-x-auto">
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-[14px] font-bold">{card.group.name} cards</h2>
              <span className="text-[11.5px] text-ink/45">{card.players.length} players</span>
            </div>
            <table className="min-w-[520px] table-base">
              <thead>
                <tr>
                  <th>Player</th>
                  {card.holes.map((h) => <th key={h.holeNumber} className="w-6 px-1 text-center">{h.holeNumber}</th>)}
                  <th className="text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                {card.players.map((player) => (
                  <tr key={player.id} className={player.id === activePlayer?.id ? "bg-fairway-50/50" : ""}>
                    <td className="whitespace-nowrap text-[12.5px] font-semibold">{player.name}</td>
                    {card.holes.map((h) => {
                      const value = player.scores[h.holeNumber];
                      return (
                        <td key={h.holeNumber} className="px-1 text-center font-mono text-[12px]">
                          <button
                            onClick={() => { setActivePlayerId(player.id); setActiveHole(h.holeNumber); }}
                            className={`inline-grid h-6 w-6 place-items-center rounded ${value ? "bg-fairway-100 font-semibold text-fairway-900" : "text-ink/25 hover:bg-ink/[0.05]"}`}
                          >
                            {value ?? "·"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="text-center font-mono text-[13px] font-bold">{player.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {/* live top 5 */}
        <aside className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-4 py-3">
              <h2 className="text-[14px] font-bold">Top 5 · live</h2>
              <span className={`pill ${status === "live" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
                {status === "live" ? "live" : status}
              </span>
            </div>
            <ul className="divide-y divide-ink/[0.06]">
              {topFive.map((s) => (
                <li key={s.playerId} className={`flex items-center gap-3 px-4 py-2.5 ${s.playerId === activePlayer?.id ? "bg-fairway-50/60" : ""}`}>
                  <span className="w-5 text-center font-mono text-[12px] font-bold text-ink/45">{s.tied ? `T${s.position}` : s.position}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{s.playerName}</div>
                    <div className="text-[11px] text-ink/45">thru {s.thru} · {formatToPar(s.toPar)}</div>
                  </div>
                  <span className="font-mono text-[14px] font-extrabold">{card.event.format === "STABLEFORD" ? s.points : formatToPar(s.netToPar)}</span>
                </li>
              ))}
              {topFive.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-ink/45">The board is empty - you could be first.</li>}
            </ul>
            <div className="border-t border-ink/[0.06] px-4 py-2.5 text-center">
              <Link href={`/live/${card.event.slug}`} className="text-[12px] font-semibold text-fairway-700 hover:text-fairway-900">
                Open the full leaderboard →
              </Link>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-[14px] font-bold">Your four-ball</h2>
            <ul className="mt-2.5 space-y-2">
              {[...card.players].sort((a, b) => b.points - a.points).map((p, i) => (
                <li key={p.id} className="flex items-center gap-2.5">
                  <span className="w-4 text-center font-mono text-[11.5px] text-ink/40">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{p.name}</div>
                    <div className="text-[11px] text-ink/45">PH {p.playingHandicap} · thru {p.thru} · {formatToPar(p.toPar)} gross</div>
                  </div>
                  <span className="font-mono text-[13.5px] font-bold">{p.points}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-ink/50">
              Hole {ordinal(hole?.holeNumber ?? 1)} - {stablefordPoints(hole?.par ?? 4, existing ?? hole?.par ?? 4, received)} points if you
              make {existing ?? hole?.par ?? 4}. Everyone&apos;s card updates the leaderboard instantly.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
