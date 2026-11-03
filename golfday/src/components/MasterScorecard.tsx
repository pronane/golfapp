"use client";

import { useCallback, useEffect, useState } from "react";
import { teamBoardKind } from "@/lib/eventFormats";

type Hole = { holeNumber: number; par: number; strokeIndex: number };
type Card = {
  playerId: string;
  name: string;
  group: string | null;
  playingHandicap: number;
  scores: { holeNumber: number; strokes: number; round?: number }[];
};
type PairCardRow = {
  pairId: string;
  name: string;
  members: { playerId: string; name: string }[];
  scores: { holeNumber: number; strokes: number }[];
};
type Team = {
  groupId: string;
  name: string;
  teeTime: string | null;
  members: { playerId: string; name: string }[];
  scores: { holeNumber: number; strokes: number; drivePlayerId: string | null }[];
};
type CardsResponse = { format: string; rounds?: number; holes: Hole[]; cards: Card[]; teams: Team[]; pairCards?: PairCardRow[] };
type Amendment = {
  id: string;
  playerName: string | null;
  holeNumber: number;
  oldStrokes: number | null;
  newStrokes: number;
  changedBy: string | null;
  changedAt: string;
};

/**
 * The master scorecard: every card in the field on one screen, for the
 * organiser to fix (or penalise) a number without walking the course.
 *
 * Each edit goes through the ordinary scoring endpoints with the admin session,
 * so it is authorised, it bumps the live board, and it is written to the audit
 * trail shown underneath. Nothing here is a back door.
 */
export function MasterScorecard({ eventId, scramble }: { eventId: string; scramble: boolean }) {
  const [data, setData] = useState<CardsResponse | null>(null);
  const [round, setRound] = useState(1);
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cardsRes, auditRes] = await Promise.all([
      fetch(`/api/events/${eventId}/cards`),
      fetch(`/api/events/${eventId}/audit`),
    ]);
    if (!cardsRes.ok) {
      setError("Only an event admin can open the master scorecard.");
      return;
    }
    setData(await cardsRes.json());
    if (auditRes.ok) setAmendments((await auditRes.json()).amendments ?? []);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setScore(input: {
    playerId?: string;
    groupId?: string;
    pairId?: string;
    holeNumber: number;
    strokes: number | null;
    round?: number;
  }) {
    setBusy(true);
    setError(null);
    try {
      if (input.strokes === null) {
        setError("Clear a hole from the player's own scorecard for now - this grid only amends numbers.");
        return;
      }
      const pairMode = data ? teamBoardKind(data.format) === "PAIR" : false;
      const url = scramble ? "/api/scramble" : pairMode ? "/api/pair-scores" : "/api/scores";
      const body = scramble
        ? { eventId, groupId: input.groupId, holeNumber: input.holeNumber, strokes: input.strokes }
        : pairMode
          ? { eventId, pairId: input.pairId, holeNumber: input.holeNumber, strokes: input.strokes }
          : { eventId, playerId: input.playerId, holeNumber: input.holeNumber, strokes: input.strokes, round: input.round ?? round };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not save that score");
      setSaved(`${scramble ? "Team" : pairMode ? "Pair" : "Card"} hole ${input.holeNumber} set to ${input.strokes}`);
      window.setTimeout(() => setSaved(null), 2200);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that score");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="card card-pad text-[13px] text-ink/55">{error ?? "Loading every card…"}</div>
    );
  }

  type Cell = { holeNumber: number; strokes: number | undefined; onSave: (value: number) => void };
  type Row = { key: string; label: string; sub: string; cells: Cell[] };

  const pairMode = teamBoardKind(data.format) === "PAIR";
  const rounds = data.rounds ?? 1;
  const rows: Row[] = scramble
    ? data.teams.map((team) => {
        const byHole = new Map(team.scores.map((row) => [row.holeNumber, row.strokes]));
        return {
          key: team.groupId,
          label: team.name,
          sub: team.members.map((m) => m.name.split(" ")[0]).join(" / "),
          cells: data.holes.map((hole) => ({
            holeNumber: hole.holeNumber,
            strokes: byHole.get(hole.holeNumber),
            onSave: (value: number) => void setScore({ groupId: team.groupId, holeNumber: hole.holeNumber, strokes: value }),
          })),
        };
      })
    : pairMode
      ? (data.pairCards ?? []).map((pair) => {
          const byHole = new Map(pair.scores.map((row) => [row.holeNumber, row.strokes]));
          return {
            key: pair.pairId,
            label: pair.name,
            sub: pair.members.map((m) => m.name.split(" ")[0]).join(" & "),
            cells: data.holes.map((hole) => ({
              holeNumber: hole.holeNumber,
              strokes: byHole.get(hole.holeNumber),
              onSave: (value: number) => void setScore({ pairId: pair.pairId, holeNumber: hole.holeNumber, strokes: value }),
            })),
          };
        })
      : data.cards.map((card) => {
          // One round at a time: a two-day event plays the same holes twice.
          const byHole = new Map(
            card.scores.filter((row) => (row.round ?? 1) === round).map((row) => [row.holeNumber, row.strokes]),
          );
          return {
            key: card.playerId,
            label: card.name,
            sub: `${card.group ?? "ungrouped"} · PH ${card.playingHandicap}`,
            cells: data.holes.map((hole) => ({
              holeNumber: hole.holeNumber,
              strokes: byHole.get(hole.holeNumber),
              onSave: (value: number) => void setScore({ playerId: card.playerId, holeNumber: hole.holeNumber, strokes: value, round }),
            })),
          };
        });

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold">Master scorecard</h2>
            <p className="text-[12.5px] text-ink/55">
              Amend any {scramble ? "team" : "player"}&apos;s hole. Every change is re-scored, pushes to the live board
              and is recorded below.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(data.rounds ?? 1) > 1 && !scramble && teamBoardKind(data.format) !== "PAIR" && (
              <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink/60">
                Round
                <select className="select w-auto py-1" value={round} onChange={(e) => setRound(Number(e.target.value))}>
                  {Array.from({ length: data.rounds ?? 1 }, (_, i) => i + 1).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="text-[11.5px] text-ink/40">
              {data.holes.length} holes · {rows.length}{" "}
              {scramble ? "teams" : teamBoardKind(data.format) === "PAIR" ? "pairs" : "cards"}
            </span>
          </div>
        </div>
        {(error || saved) && (
          <p
            className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] font-medium ${
              error ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
            }`}
          >
            {error ?? saved}
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="border-separate border-spacing-y-1 text-[12px]">
            <thead>
              <tr className="text-ink/45">
                <th className="sticky left-0 z-10 bg-white px-2 text-left font-semibold">
                  {scramble ? "Team" : teamBoardKind(data.format) === "PAIR" ? "Pair" : "Player"}
                </th>
                {data.holes.map((hole) => (
                  <th key={hole.holeNumber} className="w-9 px-0.5 text-center font-semibold" title={`Par ${hole.par} · SI ${hole.strokeIndex}`}>
                    {hole.holeNumber}
                    <div className="text-[9.5px] font-normal text-ink/35">P{hole.par}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="bg-ink/[0.02]">
                  <td className="sticky left-0 z-10 whitespace-nowrap rounded-l-lg bg-[#faf7f2] px-2 py-1">
                    <span className="font-semibold">{row.label}</span>
                    <span className="block text-[10.5px] text-ink/45">{row.sub}</span>
                  </td>
                  {row.cells.map((cell, index) => (
                    <td key={`${row.key}-${cell.holeNumber}`} className={`px-0.5 py-1 text-center ${index === row.cells.length - 1 ? "rounded-r-lg" : ""}`}>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        inputMode="numeric"
                        aria-label={`${row.label} hole ${cell.holeNumber}`}
                        className="h-7 w-8 rounded border border-transparent bg-white/70 text-center font-mono text-[11.5px] font-semibold outline-none focus:border-fairway-400 focus:bg-white"
                        defaultValue={cell.strokes ?? ""}
                        disabled={busy}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                        }}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isInteger(value) || value < 1 || value > 20) return;
                          if (value === cell.strokes) return;
                          cell.onSave(value);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink/40">Type over a number and press Enter, or click away, to save. Blank cells have no score yet.</p>
      </div>

      <div className="card card-pad">
        <h2 className="text-[15px] font-bold">Amendments</h2>
        <p className="text-[12.5px] text-ink/55">Every score that changed after it was first entered, with who changed it.</p>
        {amendments.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink/45">Nothing amended yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/[0.06]">
            {amendments.slice(0, 30).map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12.5px]">
                <span>
                  <span className="font-semibold">{row.playerName ?? "A player"}</span> hole {row.holeNumber}:{" "}
                  <span className="font-mono">{row.oldStrokes ?? "–"}</span> → <span className="font-mono font-bold">{row.newStrokes}</span>
                </span>
                <span className="text-[11.5px] text-ink/45">{row.changedAt.replace("T", " ").slice(0, 16)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
