/**
 * The four team formats: pair cards (foursomes / greensomes), derived boards
 * (shamble / best two of four), and the catalogue rules that decide which
 * engine a format reaches - plus the round rules that keep a two-day event
 * honest.
 */
import { describe, expect, it } from "vitest";
import { pairTeamHandicap, rankScrambleTeams, scrambleTeamHandicap } from "@/lib/scramble";
import { rankDerivedTeams, type DerivedMember } from "@/lib/derivedTeams";
import {
  EVENT_FORMATS,
  boardFormat,
  formatLabel,
  isTeamFormat,
  supportsRounds,
  teamBoardKind,
} from "@/lib/eventFormats";

const holes = [1, 2, 3].map((n) => ({ holeNumber: n, par: 4, strokeIndex: n }));

describe("the catalogue with team formats", () => {
  it("now offers thirteen formats, labelled", () => {
    expect(EVENT_FORMATS).toHaveLength(13);
    expect(formatLabel("FOURSOMES")).toBe("Foursomes");
    expect(formatLabel("GREENSOMES")).toBe("Greensomes");
    expect(formatLabel("SHAMBLE")).toBe("Shamble");
    expect(formatLabel("BEST_2_OF_4")).toBe("Best two of four");
  });

  it("classifies how each format builds its board", () => {
    expect(teamBoardKind("TEXAS_SCRAMBLE")).toBe("SCRAMBLE");
    expect(teamBoardKind("FOURSOMES")).toBe("PAIR");
    expect(teamBoardKind("GREENSOMES")).toBe("PAIR");
    expect(teamBoardKind("SHAMBLE")).toBe("DERIVED");
    expect(teamBoardKind("BEST_2_OF_4")).toBe("DERIVED");
    expect(teamBoardKind("STABLEFORD")).toBeNull();
    expect(isTeamFormat("FOURSOMES")).toBe(true);
    expect(isTeamFormat("STROKE_PLAY")).toBe(false);
  });

  it("only the one-card-per-team formats refuse multiple rounds", () => {
    // A scramble or a foursomes card has no per-player card to play twice.
    expect(supportsRounds("TEXAS_SCRAMBLE")).toBe(false);
    expect(supportsRounds("FOURSOMES")).toBe(false);
    expect(supportsRounds("GREENSOMES")).toBe(false);
    for (const format of ["STABLEFORD", "STROKE_PLAY", "GROSS_STROKE_PLAY", "SHAMBLE", "BEST_2_OF_4", "SKINS_NET"]) {
      expect(supportsRounds(format), format).toBe(true);
    }
  });

  it("ranks a shamble's own cards by net, not points", () => {
    expect(boardFormat("SHAMBLE")).toBe("STROKE_PLAY");
    expect(boardFormat("BEST_2_OF_4")).toBe("STROKE_PLAY");
  });
});

describe("foursomes / greensomes team handicap", () => {
  it("is half the sum of the partners' playing handicaps, rounded", () => {
    expect(pairTeamHandicap([10, 20])).toBe(15);
    expect(pairTeamHandicap([9, 8])).toBe(9); // 8.5 rounds up
    expect(pairTeamHandicap([0, 0])).toBe(0);
    expect(pairTeamHandicap([])).toBe(0);
  });

  it("differs from the scramble percentages, which hit course handicaps", () => {
    // Scramble: 35% + 15% of [10, 20] = 6.5 -> 7. Foursomes: 15.
    expect(scrambleTeamHandicap([10, 20])).toBe(7);
    expect(pairTeamHandicap([10, 20])).toBe(15);
  });

  it("ranks a pair card with the pair handicap and no drives owed", () => {
    const [standing] = rankScrambleTeams(
      [
        {
          groupId: "g1",
          groupName: "Pair",
          teeTime: "09:00",
          members: [
            { playerId: "a", name: "A", courseHandicap: 10, playingHandicap: 9 },
            { playerId: "b", name: "B", courseHandicap: 20, playingHandicap: 19 },
          ],
          scores: [
            { holeNumber: 1, strokes: 4 },
            { holeNumber: 2, strokes: 5 },
            { holeNumber: 3, strokes: 4 },
          ],
        },
      ],
      holes,
      "PAIR",
    );
    expect(standing.teamHandicap).toBe(14); // round((9+19)/2)
    expect(standing.drivesShort).toEqual([]);
    expect(standing.thru).toBe(3);
    expect(standing.gross).toBe(13);
  });
});

function member(overrides: Partial<DerivedMember> & Pick<DerivedMember, "playerId" | "name" | "holeResults">): DerivedMember {
  return { courseHandicap: 10, groupId: "g1", thru: overrides.holeResults.length, ...overrides };
}

const card = (nets: number[], points: number[]) =>
  nets.map((net, i) => ({
    holeNumber: i + 1,
    par: 4,
    strokeIndex: i + 1,
    strokes: net + 2, // received two shots a hole
    shotsReceived: 2,
    net,
    points: points[i] ?? 0,
    toPar: net - 4,
  }));

describe("derived team boards", () => {
  const groups = [{ id: "g1", name: "Fourball", teeTime: "09:00" }];

  it("shamble: each hole counts the best net, and every member must have carded it", () => {
    const a = member({ playerId: "a", name: "A", holeResults: card([4, 5, 4], [2, 1, 2]) });
    const b = member({ playerId: "b", name: "B", holeResults: card([5, 4, 6], [1, 2, 0]) });
    // B has not carded hole 3 yet: the hole does not settle.
    const partial = rankDerivedTeams("SHAMBLE", holes, groups, [a, { ...b, holeResults: b.holeResults.slice(0, 2), thru: 2 }]);
    expect(partial[0].thru).toBe(2);

    const [team] = rankDerivedTeams("SHAMBLE", holes, groups, [a, b]);
    expect(team.thru).toBe(3);
    expect(team.holeResults.map((h) => h.net)).toEqual([4, 4, 4]); // best net a hole
    expect(team.net).toBe(12);
    expect(team.points).toBe(6); // 2 + 2 + 2
    expect(team.teamHandicap).toBe(0); // nets come off the members' own cards
    expect(team.drivesShort).toEqual([]);
  });

  it("best two of four: the hole counts the sum of the two best nets", () => {
    const members = [
      member({ playerId: "a", name: "A", holeResults: card([4, 5], [2, 1]) }),
      member({ playerId: "b", name: "B", holeResults: card([5, 4], [1, 2]) }),
      member({ playerId: "c", name: "C", holeResults: card([6, 6], [0, 0]) }),
      member({ playerId: "d", name: "D", holeResults: card([7, 7], [0, 0]) }),
    ];
    const [team] = rankDerivedTeams("BEST_2_OF_4", holes, groups, members);
    expect(team.holeResults.map((h) => h.net)).toEqual([9, 9]); // 4+5, 4+5
    expect(team.points).toBe(6); // (2+1) + (1+2)
    expect(team.thru).toBe(2);
  });

  it("an empty group and an unplayed team behave like the scramble board", () => {
    const none = rankDerivedTeams("SHAMBLE", holes, [{ id: "gx", name: "Empty", teeTime: null }], []);
    expect(none).toEqual([]);
    const idle = member({ playerId: "a", name: "A", holeResults: [], thru: 0 });
    const [team] = rankDerivedTeams("SHAMBLE", holes, groups, [idle]);
    expect(team.thru).toBe(0);
    expect(team.points).toBe(0);
    expect(team.position).toBe(1); // alone on the board
  });

  it("ranks by points, then net to par, exactly like the scramble board", () => {
    // Two teams: g1 holes out better on points, g2 better on net.
    const groups2 = [
      { id: "g1", name: "One", teeTime: "09:00" },
      { id: "g2", name: "Two", teeTime: "09:10" },
    ];
    const t1 = member({ playerId: "a", name: "A", groupId: "g1", holeResults: card([4, 4, 4], [3, 3, 3]) });
    const t2 = member({ playerId: "b", name: "B", groupId: "g2", holeResults: card([3, 3, 3], [2, 2, 2]) });
    const ranked = rankDerivedTeams("SHAMBLE", holes, groups2, [t1, t2]);
    expect(ranked[0].groupName).toBe("One"); // 9 points beats 6
    expect(ranked[0].position).toBe(1);
    expect(ranked[1].position).toBe(2);
  });
});
