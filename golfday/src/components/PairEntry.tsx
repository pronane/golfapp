"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { GroupScoreboard, LeaderboardPayload } from "@/lib/leaderboard";
import type { PairCard } from "@/lib/scrambleScores";
import { formatEventDate, formatToPar, ordinal } from "@/lib/format";
import { teamStrokesReceived } from "@/lib/scramble";
import { LiveDot } from "./Icons";
import { useLiveBoard } from "./useLiveBoard";

type Props = {
  initial: GroupScoreboard;
  initialBoard: LeaderboardPayload | null;
};

const SCORE_WORDS: Record<number, string> = {
  1: "Hole in one",
  2: "Eagle",
  3: "Birdie",
  4: "Par",
  5: "Bogey",
  6: "Double",
  7: "Triple",
  8: "Blow-up",
};

/**
 * Foursomes / greensomes pair card.
 *
 * One score per hole for the pair (alternate shot - there is no drive to
 * credit), opened from the four-ball's normal scoring link: a group of four
 * carries two pair cards, picked between with the tabs at the top. The team
 * handicap is half the sum of the partners' playing handicaps, and the screen
 * says so next to the pair's name.
 */
export function PairEntry({ initial, initialBoard }: Props) {
  const [card, setCard] = useState(initial);
  const pairs = card.pairCards ?? [];
  const [activePairId, setActivePairId] = useState(pairs[0]?.pairId ?? "");
  const pair = pairs.find((p) => p.pairId === activePairId) ?? pairs[0];
  const token = card.group.token;

  const firstMissing = pair?.holes.find((h) => h.strokes === null)?.holeNumber;
  const [activeHole, setActiveHole] = useState(firstMissing ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { board } = useLiveBoard(initial.event.id, initialBoard, true);
  const teams = (board ?? initialBoard)?.teams ?? [];

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/groups/${token}`, { cache: "no-store" });
    if (!res.ok) return;
    setCard((await res.json()) as GroupScoreboard);
  }, [token]);

  const hole = pair?.holes.find((h) => h.holeNumber === activeHole) ?? pair?.holes[0];
  const existing = hole?.strokes ?? null;
  const teamHandicap = pair?.teamHandicap ?? 0;

  async function save(strokes: number) {
    if (!hole || !pair) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/pair-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: card.event.id,
          pairId: pair.pairId,
          holeNumber: hole.holeNumber,
          strokes,
          token,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that score");
      await refresh();
      setSaved(`Hole ${hole.holeNumber} saved - the board is updated.`);
      window.setTimeout(() => setSaved(null), 2500);
      const next = pair.holes.find((h) => h.holeNumber > hole.holeNumber && h.strokes === null);
      if (next) setActiveHole(next.holeNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that score");
    } finally {
      setSaving(false);
    }
  }

  if (pairs.length === 0) {
    return (
      <div className="card card-pad">
        <h1 className="text-lg font-bold">No pairs yet</h1>
        <p className="mt-1 text-[13px] text-ink/60">
          The organiser pairs the field from the console (Foursomes needs each two-ball drawn first), then this
          link opens the pair&apos;s card.
        </p>
      </div>
    );
  }

  const scoredHoles = pair ? pair.holes.filter((h) => h.strokes !== null).length : 0;
  const teamPosition = teams.find((t) => t.groupId === pair?.pairId)?.position;

  return (
    <div className="space-y-4">
      <header className="card sticky top-0 z-20 overflow-hidden">
        <div className="hero px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fairway-700/70">
                <LiveDot /> {card.event.format === "GREENSOMES" ? "Greensomes" : "Foursomes"} · {card.group.name}
              </div>
              <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">{card.event.name}</h1>
              <p className="text-[11.5px] hero-muted">
                {card.event.courseName} · {formatEventDate(card.event.date)} · tee {card.group.teeTime ?? "TBC"} · pair
                handicap {teamHandicap}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="pill hero-chip">
                {scoredHoles}/{pair?.holes.length ?? 18} holes in
              </span>
              <Link href={`/live/${card.event.slug}`} className="btn-secondary btn-sm">
                Leaderboard
              </Link>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-ink/[0.06] border-t border-ink/[0.06]">
          <Stat label="Pair points" value={String(pair?.totals.points ?? 0)} />
          <Stat label="To par" value={pair?.totals.thru ? formatToPar(pair.totals.toPar) : "–"} />
          <Stat label="Position" value={scoredHoles === 0 ? "–" : teamPosition ? ordinal(teamPosition) : "–"} />
        </div>
      </header>

      {pairs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {pairs.map((p) => (
            <button
              key={p.pairId}
              onClick={() => {
                setActivePairId(p.pairId);
                const first = p.holes.find((h) => h.strokes === null);
                setActiveHole(first?.holeNumber ?? 1);
              }}
              className={`pill ${p.pairId === pair?.pairId ? "bg-fairway-300 text-fairway-950 ring-fairway-400" : "bg-ink/[0.04] text-ink/65 ring-ink/10 hover:bg-ink/[0.08]"}`}
            >
              {p.pairName} · {p.members.map((m) => m.name.split(" ")[0]).join(" & ")}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <section className="card card-pad">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold">Holes</h2>
              <span className="text-[11.5px] text-ink/45">One score for the pair</span>
            </div>
            <div className="mt-3 grid grid-cols-9 gap-1.5">
              {(pair?.holes ?? []).map((h) => {
                const isActive = h.holeNumber === hole?.holeNumber;
                return (
                  <button
                    key={h.holeNumber}
                    onClick={() => setActiveHole(h.holeNumber)}
                    className={`relative rounded-lg py-2 text-center transition ${
                      isActive
                        ? "bg-fairway-300 text-fairway-950 ring-2 ring-fairway-500"
                        : h.strokes !== null
                          ? "bg-fairway-50 text-fairway-900 ring-1 ring-inset ring-fairway-100"
                          : "bg-ink/[0.03] text-ink/50 ring-1 ring-inset ring-ink/[0.06] hover:bg-ink/[0.06]"
                    }`}
                  >
                    <div className="text-[10px] font-semibold opacity-60">{h.holeNumber}</div>
                    <div className="text-[14px] font-extrabold leading-tight">{h.strokes ?? "–"}</div>
                    <div className={`text-[9px] ${h.points !== null && h.points >= 3 && !isActive ? "font-bold text-emerald-700" : "opacity-50"}`}>
                      {h.points !== null ? `${h.points}p` : `P${h.par}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {hole && pair && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.06] px-5 py-3">
                <div>
                  <h2 className="text-[15px] font-bold">Hole {hole.holeNumber}</h2>
                  <p className="text-[12.5px] text-ink/55">
                    Par {hole.par} · stroke index {hole.strokeIndex} · the pair receives{" "}
                    <span className="font-semibold text-ink/80">{hole.shotsReceived}</span> shot
                    {hole.shotsReceived === 1 ? "" : "s"} · {pair.members.map((m) => m.name).join(" & ")}
                  </p>
                </div>
                {existing !== null && <span className="pill bg-amber-50 text-amber-700 ring-amber-200">Saved: {existing}</span>}
              </div>

              <div className="grid grid-cols-4 gap-2 p-4 sm:grid-cols-8">
                {Array.from({ length: 8 }, (_, i) => i + 1).map((strokes) => {
                  const received = teamStrokesReceived(teamHandicap, hole.strokeIndex);
                  const points = Math.max(0, hole.par + 2 - (strokes - received));
                  const selected = existing === strokes;
                  return (
                    <button
                      key={strokes}
                      onClick={() => void save(strokes)}
                      disabled={saving}
                      className={`rounded-xl px-1 py-3 text-center transition ${
                        selected
                          ? "bg-fairway-300 text-fairway-950 ring-2 ring-fairway-500"
                          : points >= 4
                            ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                            : points === 3
                              ? "bg-fairway-50 ring-1 ring-inset ring-fairway-200 hover:bg-fairway-100"
                              : "bg-white ring-1 ring-inset ring-ink/10 hover:bg-ink/[0.04]"
                      } ${saving ? "opacity-60" : ""}`}
                    >
                      <div className="text-[19px] font-extrabold leading-none">{strokes}</div>
                      <div className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${selected ? "text-fairway-800/80" : points >= 4 ? "text-emerald-700" : "text-ink/40"}`}>
                        {SCORE_WORDS[strokes - received - hole.par + 4] || `${strokes}`}
                      </div>
                      <div className={`text-[10px] font-bold ${selected ? "text-sand-700" : points >= 4 ? "text-emerald-700" : "text-ink/45"}`}>
                        {points} pt{points === 1 ? "" : "s"}
                      </div>
                    </button>
                  );
                })}
              </div>

              {error && <div className="border-t border-rose-100 bg-rose-50 px-5 py-2.5 text-[12.5px] text-rose-700">{error}</div>}
              {saved && <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-2.5 text-[12.5px] font-medium text-emerald-700">{saved}</div>}
            </section>
          )}

          <section className="card overflow-x-auto">
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-[14px] font-bold">Pair card</h2>
              <span className="text-[11.5px] text-ink/45">
                {scoredHoles} of {pair?.holes.length ?? 18} holes
              </span>
            </div>
            <table className="min-w-[620px] table-base">
              <thead>
                <tr>
                  <th>Hole</th>
                  {(pair?.holes ?? []).map((h) => (
                    <th key={h.holeNumber} className="w-6 px-1 text-center">
                      {h.holeNumber}
                    </th>
                  ))}
                  <th className="text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="whitespace-nowrap text-[12.5px] font-semibold">Par</td>
                  {(pair?.holes ?? []).map((h) => (
                    <td key={h.holeNumber} className="px-1 text-center font-mono text-[11.5px] text-ink/45">
                      {h.par}
                    </td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <td className="whitespace-nowrap text-[12.5px] font-semibold">Pair</td>
                  {(pair?.holes ?? []).map((h) => (
                    <td key={h.holeNumber} className="px-1 text-center font-mono text-[12px]">
                      <button onClick={() => setActiveHole(h.holeNumber)} className="hover:text-fairway-700">
                        {h.strokes ?? "–"}
                      </button>
                    </td>
                  ))}
                  <td className="px-2 text-center font-mono text-[12px] font-bold">{pair?.totals.points ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card card-pad">
            <h2 className="text-[14px] font-bold">The pair</h2>
            <ul className="mt-2 space-y-1.5">
              {(pair?.members ?? []).map((m) => (
                <li key={m.id} className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-ink/80">{m.name}</span>
                  <span className="font-mono text-ink/50">PH {m.playingHandicap}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11.5px] text-ink/45">
              Alternate shot off one ball. Team handicap is half the sum of the two playing handicaps, taken on the
              stroke-index holes.
            </p>
          </section>
          <section className="card card-pad">
            <h2 className="text-[14px] font-bold">Also in this four-ball</h2>
            <p className="mt-2 text-[12.5px] text-ink/55">
              The other pair&apos;s card is on the same link - switch with the tabs above. Individual positions are not
              kept in a pair competition; the pair is the team.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fairway-700/70">{label}</div>
      <div className="font-mono text-[17px] font-extrabold text-fairway-950">{value}</div>
    </div>
  );
}
