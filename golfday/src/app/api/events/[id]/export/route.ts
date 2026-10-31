import { requireEventAccess, requireUser } from "@/lib/http";
import { buildLeaderboard } from "@/lib/leaderboard";

type Ctx = { params: Promise<{ id: string }> };

/** CSV of the final leaderboard with every hole score - for the club noticeboard. */
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireEventAccess(id, user);
  const board = await buildLeaderboard(id);
  if (!board) return new Response("Event not found", { status: 404 });

  const holeNumbers = board.holes.map((h) => h.holeNumber);
  const header = [
    "Position", "Player", "Group", "Handicap", "Playing HCP", "Tee",
    ...holeNumbers.flatMap((n): (string | number)[] => [`H${n}`, `H${n} pts`]),
    "Thru", "Gross", "Net", "Net to par", "Points", "To par",
  ];
  const lines = [header.join(",")];
  for (const s of board.standings) {
    const byHole = new Map(s.holeResults.map((r) => [r.holeNumber, r]));
    const cells = [
      s.position, s.playerName, s.groupName ?? "", s.handicapIndex, s.playingHandicap, s.tee,
      ...holeNumbers.flatMap((n): (string | number)[] => {
        const r = byHole.get(n);
        return r ? [r.strokes, r.points] : ["", ""];
      }),
      s.thru, s.totalStrokes, s.totalNet, s.netToPar, s.points, s.toPar,
    ];
    lines.push(cells.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(","));
  }
  const filename = `${board.event.slug}-leaderboard.csv`;
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Player and group names are user-supplied. A name like `=HYPERLINK(...)` would
 * run as a formula when the organiser opens the CSV in Excel/Sheets, so text
 * cells that start with a formula character are prefixed with an apostrophe.
 */
function csvSafe(value: string | number): string {
  if (typeof value === "number") return String(value);
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
