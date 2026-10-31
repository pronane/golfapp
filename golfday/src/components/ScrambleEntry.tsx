"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { GroupScoreboard, LeaderboardPayload } from "@/lib/leaderboard";
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
 * Texas scramble team card.
 *
 * One score per hole for the whole team, plus whose drive the team used. The
 * drive ledger is the thing societies argue about afterwards, so it is shown
 * right next to the card: each player has a minimum number of drives to
 * contribute and the screen says who still owes one.
 */
export function ScrambleEntry({ initial, initialBoard }: Props) {
  const [card, setCard] = useState(initial);
  const scramble = card.scramble;
  const token = card.group.token;

  const firstMissing = scramble?.holes.find((h) => h.strokes === null)?.holeNumber;
  const [activeHole, setActiveHole] = useState(firstMissing ?? 1);
  const [drivePlayerId, setDrivePlayerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { board, status } = useLiveBoard(initial.event.id, initialBoard, true);
  const teams = (board ?? initialBoard)?.teams ?? [];

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/groups/${token}`, { cache: "no-store" });
    if (!res.ok) return;
    setCard((await res.json()) as GroupScoreboard);
  }, [token]);

  const hole = scramble?.holes.find((h) => h.holeNumber === activeHole) ?? scramble?.holes[0];
  const existing = hole?.strokes ?? null;
  const teamHandicap = scramble?.teamHandicap ?? 0;

  const options = useMemo(() => {
    if (!hole) return [];
    return Array.from({ length: 8 }, (_, i) => i + 1).map((strokes) => {
      const received = teamStrokesReceived(teamHandicap, hole.strokeIndex);
      const points = Math.max(0, hole.par + 2 - (strokes - received));
      return { strokes, points, name: SCORE_WORDS[strokes - received - hole.par + 4] ?? "" };
    });
  }, [hole, teamHandicap]);

  async function save(strokes: number, drive: string | null) {
    if (!hole) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/scramble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: card.event.id,
          groupId: card.group.id,
          holeNumber: hole.holeNumber,
          strokes,
          drivePlayerId: drive,
          token,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that score");
      await refresh();
      setSaved(`Hole ${hole.holeNumber} saved - the board is updated.`);
      window.setTimeout(() => setSaved(null), 2500);
      // Move to the next hole that has no score yet.
      const next = card.scramble?.holes.find((h) => h.holeNumber > hole.holeNumber && h.strokes === null);
      if (next) setActiveHole(next.holeNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that score");
    } finally {
      setSaving(false);
    }
  }

  async function creditDrive(playerId: string) {
    setDrivePlayerId(playerId);
    // Only re-save a hole that already has a score: before the team has carded
    // the hole there is nothing to attach the drive to yet.
    if (existing !== null && hole) await save(existing, playerId);
  }

  if (!scramble) {
    return (
      <div className="card card-pad">
        <h1 className="text-lg font-bold">This is not a scramble</h1>
        <p className="mt-1 text-[13px] text-ink/60">Use the normal scorecard for this golf day.</p>
      </div>
    );
  }

  const scoredHoles = scramble.holes.filter((h) => h.strokes !== null).length;
  const allDrivesIn = scramble.members.every((m) => m.drivesNeeded === 0);
  const teamPosition = teams.find((t) => t.groupId === card.group.id)?.position;
  const leader = teams.find((t) => t.thru > 0);

  return (
    <div className="space-y-4">
      <header className="card sticky top-0 z-20 overflow-hidden">
        <div className="bg-fairway-950 px-5 py-3 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fairway-100/60">
                <LiveDot /> Texas scramble · {card.group.name}
              </div>
              <h1 className="truncate text-lg font-extrabold leading-tight tracking-tight">{card.event.name}</h1>
              <p className="text-[11.5px] text-fairway-100/60">
                {card.event.courseName} · {formatEventDate(card.event.date)} · tee {card.group.teeTime ?? "TBC"} · team handicap{" "}
                {scramble.teamHandicap}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="pill bg-white/10 text-white/80 ring-white/15">
                {scoredHoles}/{scramble.holes.length} holes in
              </span>
              <Link href={`/live/${card.event.slug}`} className="btn btn-sm bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/15">
                Leaderboard
              </Link>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-ink/[0.06] border-t border-ink/[0.06]">
          <Stat label="Team points" value={String(scramble.totals.points)} />
          <Stat label="To par" value={scramble.totals.thru ? formatToPar(scramble.totals.toPar) : "–"} />
          <Stat
            label="Position"
            value={scoredHoles === 0 ? "–" : teamPosition ? ordinal(teamPosition) : "–"}
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <section className="card card-pad">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold">Holes</h2>
              <span className="text-[11.5px] text-ink/45">One score for the team</span>
            </div>
            <div className="mt-3 grid grid-cols-9 gap-1.5">
              {scramble.holes.map((h) => {
                const isActive = h.holeNumber === hole?.holeNumber;
                const driver = scramble.members.find((m) => m.id === h.drivePlayerId);
                return (
                  <button
                    key={h.holeNumber}
                    onClick={() => {
                      setActiveHole(h.holeNumber);
                      setDrivePlayerId(h.drivePlayerId);
                    }}
                    className={`relative rounded-lg py-2 text-center transition ${
                      isActive
                        ? "bg-fairway-700 text-white ring-2 ring-fairway-700"
                        : h.strokes !== null
                          ? "bg-fairway-50 text-fairway-900 ring-1 ring-inset ring-fairway-100"
                          : "bg-ink/[0.03] text-ink/50 ring-1 ring-inset ring-ink/[0.06] hover:bg-ink/[0.06]"
                    }`}
                    title={driver ? `Drive: ${driver.name}` : undefined}
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

          {hole && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.06] px-5 py-3">
                <div>
                  <h2 className="text-[15px] font-bold">Hole {hole.holeNumber}</h2>
                  <p className="text-[12.5px] text-ink/55">
                    Par {hole.par} · stroke index {hole.strokeIndex} · team receives{" "}
                    <span className="font-semibold text-ink/80">{hole.shotsReceived}</span> shot{hole.shotsReceived === 1 ? "" : "s"}
                  </p>
                </div>
                {existing !== null && <span className="pill bg-amber-50 text-amber-700 ring-amber-200">Saved: {existing}</span>}
              </div>

              <div className="grid grid-cols-4 gap-2 p-4 sm:grid-cols-8">
                {options.map(({ strokes, points, name }) => {
                  const selected = existing === strokes && drivePlayerId === (hole.drivePlayerId ?? null);
                  return (
                    <button
                      key={strokes}
                      onClick={() => void save(strokes, drivePlayerId)}
                      disabled={saving}
                      className={`rounded-xl px-1 py-3 text-center transition ${
                        selected
                          ? "bg-fairway-700 text-white ring-2 ring-fairway-700"
                          : points >= 4
                            ? "bg-emerald-50 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                            : points === 3
                              ? "bg-fairway-50 ring-1 ring-inset ring-fairway-200 hover:bg-fairway-100"
                              : "bg-white ring-1 ring-inset ring-ink/10 hover:bg-ink/[0.04]"
                      } ${saving ? "opacity-60" : ""}`}
                    >
                      <div className="text-[19px] font-extrabold leading-none">{strokes}</div>
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

              <div className="border-t border-ink/[0.06] px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-ink/70">Drive used:</span>
                  {scramble.members.map((member) => {
                    const isDrive = drivePlayerId === member.id;
                    return (
                      <button
                        key={member.id}
                        onClick={() => void creditDrive(member.id)}
                        disabled={saving}
                        className={`pill ${isDrive ? "bg-fairway-700 text-white ring-fairway-700" : "bg-ink/[0.04] text-ink/65 ring-ink/10 hover:bg-ink/[0.08]"}`}
                      >
                        {member.name.split(" ")[0]} · {member.drives}
                        {member.drivesNeeded > 0 && !isDrive ? <span className="ml-1 text-amber-600">({member.drivesNeeded} to go)</span> : null}
                      </button>
                    );
                  })}
                  {drivePlayerId && (
                    <button onClick={() => setDrivePlayerId(null)} className="text-[11.5px] text-ink/45 underline">
                      clear
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11.5px] text-ink/45">
                  Each player&apos;s drive has to be used at least {scramble.minDrives} time{scramble.minDrives === 1 ? "" : "s"} over the round.
                </p>
              </div>

              {error && <div className="border-t border-rose-100 bg-rose-50 px-5 py-2.5 text-[12.5px] text-rose-700">{error}</div>}
              {saved && <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-2.5 text-[12.5px] font-medium text-emerald-700">{saved}</div>}
            </section>
          )}

          <section className="card overflow-x-auto">
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-[14px] font-bold">Team card</h2>
              <span className="text-[11.5px] text-ink/45">{scoredHoles} of {scramble.holes.length} holes</span>
            </div>
            <table className="min-w-[620px] table-base">
              <thead>
                <tr>
                  <th>Hole</th>
                  {scramble.holes.map((h) => (
                    <th key={h.holeNumber} className="w-6 px-1 text-center">{h.holeNumber}</th>
                  ))}
                  <th className="text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="whitespace-nowrap text-[12.5px] font-semibold">Par</td>
                  {scramble.holes.map((h) => (
                    <td key={h.holeNumber} className="px-1 text-center font-mono text-[11.5px] text-ink/45">{h.par}</td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <td className="whitespace-nowrap text-[12.5px] font-semibold">Team</td>
                  {scramble.holes.map((h) => (
                    <td key={h.holeNumber} className="px-1 text-center font-mono text-[12px]">
                      <button
                        onClick={() => {
                          setActiveHole(h.holeNumber);
                          setDrivePlayerId(h.drivePlayerId);
                        }}
                        className={`inline-grid h-6 w-6 place-items-center rounded ${h.strokes !== null ? "bg-fairway-100 font-semibold text-fairway-900" : "text-ink/25 hover:bg-ink/[0.05]"}`}
                      >
                        {h.strokes ?? "·"}
                      </button>
                    </td>
                  ))}
                  <td className="text-center font-mono text-[13px] font-bold">{scramble.totals.points}</td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap text-[12.5px] font-semibold">Drive</td>
                  {scramble.holes.map((h) => {
                    const driver = scramble.members.find((m) => m.id === h.drivePlayerId);
                    return (
                      <td key={h.holeNumber} className="px-1 text-center text-[10.5px] text-ink/50" title={driver?.name}>
                        {driver ? driver.name.split(" ")[0].slice(0, 3) : "·"}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink/[0.06] px-4 py-3">
              <h2 className="text-[14px] font-bold">Team board · live</h2>
              <span className={`pill ${status === "live" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
                {status === "live" ? "live" : status}
              </span>
            </div>
            <ul className="divide-y divide-ink/[0.06]">
              {teams.slice(0, 6).map((team) => (
                <li key={team.groupId} className={`flex items-center gap-3 px-4 py-2.5 ${team.groupId === card.group.id ? "bg-fairway-50/60" : ""}`}>
                  <span className="w-5 text-center font-mono text-[12px] font-bold text-ink/45">{team.tied ? `T${team.position}` : team.position}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{team.groupName}</div>
                    <div className="text-[11px] text-ink/45">thru {team.thru} · {formatToPar(team.toPar)}</div>
                  </div>
                  <span className="font-mono text-[14px] font-extrabold">{team.points}</span>
                </li>
              ))}
              {teams.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-ink/45">The board is empty - you could be first.</li>}
            </ul>
            <div className="border-t border-ink/[0.06] px-4 py-2.5 text-center">
              <Link href={`/live/${card.event.slug}`} className="text-[12px] font-semibold text-fairway-700 hover:text-fairway-900">
                Open the full leaderboard →
              </Link>
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="text-[14px] font-bold">Drives</h2>
            <p className="text-[12px] text-ink/55">
              {allDrivesIn ? "Every player has had a drive used." : `Each player needs ${scramble.minDrives} drives over the round.`}
            </p>
            <ul className="mt-2.5 space-y-2">
              {scramble.members.map((member) => (
                <li key={member.id} className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{member.name}</div>
                    <div className="text-[11px] text-ink/45">Course handicap {member.courseHandicap}</div>
                  </div>
                  <span className={`pill ${member.drivesNeeded > 0 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>
                    {member.drives} drives
                  </span>
                </li>
              ))}
            </ul>
            {leader && leader.groupId !== card.group.id && (
              <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-ink/55">
                Leading: {leader.groupName} on {leader.points} points, {formatToPar(leader.toPar)}.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5 text-center">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/45">{label}</div>
      <div className="font-mono text-[16px] font-extrabold text-ink">{value}</div>
    </div>
  );
}
