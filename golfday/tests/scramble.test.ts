import { describe, expect, it } from "vitest";
import {
  countDrives,
  minimumDrives,
  rankScrambleTeams,
  scrambleAllowances,
  scrambleTeamHandicap,
  summariseScramble,
  teamStrokesReceived,
} from "@/lib/scramble";

const holes = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

const team = [
  { playerId: "p1", name: "Alex", courseHandicap: 10 },
  { playerId: "p2", name: "Sam", courseHandicap: 18 },
  { playerId: "p3", name: "Priya", courseHandicap: 26 },
  { playerId: "p4", name: "Jo", courseHandicap: 34 },
];

describe("Texas scramble handicaps", () => {
  it("uses the published scramble allowances for each team size", () => {
    expect(scrambleAllowances(2)).toEqual([0.35, 0.15]);
    expect(scrambleAllowances(3)).toEqual([0.3, 0.2, 0.1]);
    expect(scrambleAllowances(4)).toEqual([0.25, 0.2, 0.15, 0.1]);
  });

  it("applies the percentages lowest handicap first and rounds the total", () => {
    // 10*25% + 18*20% + 26*15% + 34*10% = 2.5 + 3.6 + 3.9 + 3.4 = 13.4 -> 13
    expect(scrambleTeamHandicap([34, 10, 26, 18])).toBe(13);
    // A three-ball of 12/20/28 = 3.6 + 4 + 2.8 = 10.4 -> 10
    expect(scrambleTeamHandicap([20, 12, 28])).toBe(10);
    // A two-ball of 5 and 21 = 1.75 + 3.15 = 4.9 -> 5
    expect(scrambleTeamHandicap([5, 21])).toBe(5);
  });

  it("gives strokes on the hardest holes and wraps for handicaps over 18", () => {
    expect(teamStrokesReceived(13, 1)).toBe(1);
    expect(teamStrokesReceived(13, 13)).toBe(1);
    expect(teamStrokesReceived(13, 14)).toBe(0);
    expect(teamStrokesReceived(20, 2)).toBe(2);
    expect(teamStrokesReceived(20, 3)).toBe(1);
    expect(teamStrokesReceived(0, 1)).toBe(0);
  });
});

describe("summariseScramble", () => {
  it("scores the team off one ball, hole by hole", () => {
    const scores = holes.slice(0, 4).map((h) => ({ holeNumber: h.holeNumber, strokes: 4, drivePlayerId: "p1" }));
    const totals = summariseScramble(holes, scores, 0, team);
    expect(totals.holesPlayed).toBe(4);
    expect(totals.gross).toBe(16);
    expect(totals.points).toBe(8); // four net pars
    expect(totals.toPar).toBe(0);
    expect(totals.results[0].drivePlayerName).toBe("Alex");
  });

  it("counts strokes received and ignores holes with no score", () => {
    // Team off 13: one stroke on holes 1-13.
    const scores = [
      { holeNumber: 1, strokes: 5, drivePlayerId: "p1" },
      { holeNumber: 14, strokes: 5, drivePlayerId: "p2" },
    ];
    const totals = summariseScramble(holes, scores, 13, team);
    expect(totals.results[0].shotsReceived).toBe(1);
    expect(totals.results[0].net).toBe(4);
    expect(totals.results[0].points).toBe(2);
    expect(totals.results[1].shotsReceived).toBe(0);
    expect(totals.results[1].points).toBe(1);
    expect(totals.holesPlayed).toBe(2);
    expect(totals.net).toBe(9);
  });
});

describe("minimum drives", () => {
  it("splits the card across the team", () => {
    expect(minimumDrives(4, 18)).toBe(4);
    expect(minimumDrives(3, 18)).toBe(6);
    expect(minimumDrives(2, 18)).toBe(9);
    expect(minimumDrives(0, 18)).toBe(0);
  });

  it("counts whose drive was used on each hole", () => {
    const scores = [
      { holeNumber: 1, strokes: 4, drivePlayerId: "p1" },
      { holeNumber: 2, strokes: 4, drivePlayerId: "p1" },
      { holeNumber: 3, strokes: 4, drivePlayerId: "p2" },
      { holeNumber: 4, strokes: 4, drivePlayerId: null },
    ];
    const counts = countDrives(scores);
    expect(counts.get("p1")).toBe(2);
    expect(counts.get("p2")).toBe(1);
    expect(counts.get("p3")).toBeUndefined();
  });
});

describe("rankScrambleTeams", () => {
  const teamA = {
    groupId: "g1",
    groupName: "Group 1",
    teeTime: "08:30",
    members: team,
    scores: holes.map((h) => ({ holeNumber: h.holeNumber, strokes: 4, drivePlayerId: team[h.holeNumber % 4].playerId })),
  };
  const teamB = {
    groupId: "g2",
    groupName: "Group 2",
    teeTime: "08:40",
    members: [
      { playerId: "p5", name: "Mo", courseHandicap: 12 },
      { playerId: "p6", name: "Kit", courseHandicap: 16 },
    ],
    scores: holes.map((h) => ({ holeNumber: h.holeNumber, strokes: 5, drivePlayerId: "p5" })),
  };

  it("ranks teams on Stableford points and marks drives owed", () => {
    const rows = rankScrambleTeams([teamB, teamA], holes);
    expect(rows[0].groupId).toBe("g1");
    expect(rows[0].position).toBe(1);
    expect(rows[0].members.every((m) => m.drivesNeeded === 0)).toBe(true);
    expect(rows[1].position).toBe(2);
    // Group 2 are a two-ball: nine drives each are owed, only p5 has any.
    expect(rows[1].drivesShort).toContain("Kit");
    expect(rows[1].members.find((m) => m.playerId === "p5")?.drivesNeeded).toBe(0);
  });

  it("shares a position when teams are level", () => {
    const rows = rankScrambleTeams(
      [
        { ...teamA, groupId: "a", groupName: "A" },
        { ...teamA, groupId: "b", groupName: "B" },
      ],
      holes,
    );
    expect(rows.map((r) => r.position)).toEqual([1, 1]);
    expect(rows.every((r) => r.tied)).toBe(true);
  });

  it("keeps teams with no card at the bottom", () => {
    const blank = { ...teamB, groupId: "g3", groupName: "Group 3", scores: [] };
    const rows = rankScrambleTeams([blank, teamA], holes);
    expect(rows[0].groupId).toBe("g1");
    expect(rows[1].thru).toBe(0);
    expect(rows[1].position).toBe(2);
  });

  it("ignores a tee group with nobody in it", () => {
    const empty = { ...teamA, groupId: "empty", members: [], scores: [] };
    expect(rankScrambleTeams([empty], holes)).toHaveLength(0);
  });
});
