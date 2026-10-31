import { describe, expect, it } from "vitest";
import { courseHandicap, parseTees, playingHandicap, strokesReceived } from "@/lib/handicap";
import { rankStandings, stablefordPoints, summariseRound } from "@/lib/scoring";
import { parsePlayerCsv } from "@/lib/golfengland";

describe("course handicap (WHS)", () => {
  it("uses slope and rating", () => {
    // index 12.4 on 132 slope, 73.5 rating, par 72
    expect(courseHandicap(12.4, { slope: 132, rating: 73.5, par: 72 })).toBe(16);
  });

  it("falls back to slope 113", () => {
    expect(courseHandicap(10, { slope: 0, rating: 72, par: 72 })).toBe(10);
  });

  it("supports plus handicaps", () => {
    expect(courseHandicap(-2, { slope: 113, rating: 72, par: 72 })).toBe(-2);
  });

  it("applies the allowance", () => {
    expect(playingHandicap(18, 95)).toBe(17);
    expect(playingHandicap(18, 100)).toBe(18);
    expect(playingHandicap(7, 0)).toBe(0);
  });
});

describe("strokes received", () => {
  it("gives a shot on the hardest holes first", () => {
    expect(strokesReceived(0, 1)).toBe(0);
    expect(strokesReceived(1, 1)).toBe(1);
    expect(strokesReceived(1, 2)).toBe(0);
  });

  it("handles handicaps of 18+", () => {
    expect(strokesReceived(18, 1)).toBe(1);
    expect(strokesReceived(18, 18)).toBe(1);
    expect(strokesReceived(20, 1)).toBe(2);
    expect(strokesReceived(20, 3)).toBe(1);
    expect(strokesReceived(36, 18)).toBe(2);
  });

  it("gives strokes back for plus handicaps", () => {
    expect(strokesReceived(-2, 18)).toBe(-1);
    expect(strokesReceived(-2, 17)).toBe(-1);
    expect(strokesReceived(-2, 16)).toBe(0);
  });
});

describe("stableford", () => {
  it("scores par as 2 points", () => {
    expect(stablefordPoints(4, 4, 0)).toBe(2);
    expect(stablefordPoints(4, 4, 1)).toBe(3);
    expect(stablefordPoints(4, 3, 0)).toBe(3);
    expect(stablefordPoints(4, 3, 1)).toBe(4);
    expect(stablefordPoints(3, 1, 0)).toBe(4);
    expect(stablefordPoints(5, 2, 0)).toBe(5);
  });

  it("never goes below zero", () => {
    expect(stablefordPoints(4, 9, 0)).toBe(0);
  });
});

describe("round summary", () => {
  const holes = [
    { holeNumber: 1, par: 4, strokeIndex: 1 },
    { holeNumber: 2, par: 3, strokeIndex: 2 },
    { holeNumber: 3, par: 5, strokeIndex: 3 },
  ];

  it("only counts holes that have scores", () => {
    const total = summariseRound(holes, [{ holeNumber: 1, strokes: 5 }, { holeNumber: 2, strokes: 3 }], 2);
    expect(total.holesPlayed).toBe(2);
    expect(total.totalStrokes).toBe(8);
    // hole 1: 5 strokes - 1 shot = net 4, 2 points; hole 2: 3 - 1 = 2, 3 points
    expect(total.points).toBe(5);
    expect(total.toPar).toBe(1);
  });

  it("splits front and back nine", () => {
    const nine = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));
    const scores = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, strokes: 4 }));
    const total = summariseRound(nine, scores, 0);
    expect(total.frontNine).toBe(36);
    expect(total.backNine).toBe(36);
    expect(total.points).toBe(36);
  });
});

describe("ranking", () => {
  const base = {
    groupId: null,
    groupName: null,
    tee: "White",
    handicapIndex: 10,
    playingHandicap: 10,
    totalNet: 70,
    totalStrokes: 80,
    holeResults: [],
  };

  it("ranks stableford by points, unplayed last", () => {
    const rows = [
      { ...base, playerId: "a", playerName: "Ada", points: 30, thru: 18, toPar: 6 },
      { ...base, playerId: "b", playerName: "Bob", points: 36, thru: 18, toPar: 0 },
      { ...base, playerId: "c", playerName: "Cat", points: 0, thru: 0, toPar: 0 },
    ];
    const ranked = rankStandings(rows, "STABLEFORD");
    expect(ranked.map((r) => r.playerName)).toEqual(["Bob", "Ada", "Cat"]);
    expect(ranked[0].position).toBe(1);
    expect(ranked[2].position).toBe(3);
  });

  it("shares positions for ties", () => {
    const rows = [
      { ...base, playerId: "a", playerName: "Ada", points: 36, thru: 18, toPar: 0 },
      { ...base, playerId: "b", playerName: "Bob", points: 36, thru: 18, toPar: 0 },
      { ...base, playerId: "c", playerName: "Cat", points: 30, thru: 18, toPar: 4 },
    ];
    const ranked = rankStandings(rows, "STABLEFORD");
    expect(ranked[0].position).toBe(1);
    expect(ranked[0].tied).toBe(true);
    expect(ranked[1].position).toBe(1);
    expect(ranked[2].position).toBe(3);
  });

  it("ranks stroke play by net", () => {
    const rows = [
      { ...base, playerId: "a", playerName: "Ada", points: 0, thru: 18, totalNet: 74, toPar: 4 },
      { ...base, playerId: "b", playerName: "Bob", points: 0, thru: 18, totalNet: 68, toPar: -2 },
    ];
    expect(rankStandings(rows, "STROKE_PLAY").map((r) => r.playerName)).toEqual(["Bob", "Ada"]);
  });
});

describe("csv import", () => {
  it("reads a Golf England style export", () => {
    const csv = `Name,Handicap Index,Home Club,Golf England ID,Email\n"Smith, Jane",12.4,Harrow GC,GE123,jane@example.com\nO'Neil Pat,5,Sunbury GC,GE456,`;
    const { rows, errors } = parsePlayerCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Smith, Jane");
    expect(rows[0].handicapIndex).toBe(12.4);
    expect(rows[1].golfEnglandId).toBe("GE456");
  });

  it("reports bad rows", () => {
    const { rows, errors } = parsePlayerCsv("name,handicap\nJo,abc\n,12");
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("explains a missing name column", () => {
    const { errors } = parsePlayerCsv("club,handicap\nHarrow,12");
    expect(errors[0]).toContain("name");
  });
});

describe("tees", () => {
  it("parses stored tees and defaults sanely", () => {
    const tees = parseTees(JSON.stringify([{ name: "Yellow", slope: 120 }]));
    expect(tees[0].name).toBe("Yellow");
    expect(tees[0].rating).toBe(72);
    expect(parseTees("not json")[0].name).toBe("White");
  });
});
