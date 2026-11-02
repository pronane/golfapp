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

  // A Texas scramble has team cards and no individual standings, so exporting
  // only the player rows produced a header and nothing else. Teams get their own
  // sheet, with the drive each hole was taken from - that is the rule the card
  // is checking.
  if (board.teams && board.teams.length > 0) {
    const teamHeader = [
      "Position", "Team", "Players", "Team handicap", "Tee time",
      ...holeNumbers.flatMap((n): (string | number)[] => [`H${n}`, `H${n} drive`, `H${n} pts`]),
      "Thru", "Gross", "Net", "Net to par",
    ];
    const teamLines = [teamHeader.join(",")];
    for (const team of board.teams) {
      const byHole = new Map(team.holeResults.map((r) => [r.holeNumber, r]));
      const cells = [
        team.position,
        team.groupName,
        team.members.map((m) => m.name).join(" / "),
        team.teamHandicap,
        team.teeTime ?? "",
        ...holeNumbers.flatMap((n): (string | number)[] => {
          const result = byHole.get(n);
          return result ? [result.strokes, result.drivePlayerName ?? "", result.points] : ["", "", ""];
        }),
        team.thru, team.gross, team.net, team.netToPar,
      ];
      teamLines.push(cells.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(","));
    }
    const teamFile = `${board.event.slug}-teams.csv`;
    return new Response(teamLines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${teamFile}"`,
      },
    });
  }

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
