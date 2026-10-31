import { describe, expect, it } from "vitest";
import { buildOrderOfMerit, pointsForPosition, POSITION_POINTS, type SeasonFixtureResult } from "@/lib/seasons";

const fixture = (
  id: string,
  date: string,
  results: { playerId: string; playerName: string; position: number; stablefordPoints?: number; thru?: number; team?: boolean }[],
): SeasonFixtureResult => ({
  eventId: id,
  eventName: `Fixture ${id}`,
  eventSlug: `fixture-${id}`,
  date,
  holesInCard: 18,
  results: results.map((r) => ({
    playerId: r.playerId,
    playerName: r.playerName,
    position: r.position,
    thru: r.thru ?? 18,
    stablefordPoints: r.stablefordPoints ?? 30,
    team: r.team ?? false,
  })),
});

describe("order of merit points", () => {
  it("pays down a published scale and still rewards turning up", () => {
    expect(pointsForPosition(1)).toBe(100);
    expect(pointsForPosition(2)).toBe(90);
    expect(pointsForPosition(3)).toBe(80);
    expect(POSITION_POINTS.length).toBe(30);
    expect(pointsForPosition(31)).toBe(1);
    expect(pointsForPosition(0)).toBe(0);
    expect(pointsForPosition(999)).toBe(1);
  });
});

describe("buildOrderOfMerit", () => {
  it("adds up position points across fixtures", () => {
    const table = buildOrderOfMerit([
      fixture("spring", "2027-04-01", [
        { playerId: "a", playerName: "Alex", position: 1 },
        { playerId: "b", playerName: "Sam", position: 2 },
      ]),
      fixture("summer", "2027-06-01", [
        { playerId: "b", playerName: "Sam", position: 1 },
        { playerId: "a", playerName: "Alex", position: 3 },
      ]),
    ]);
    expect(table.rows.map((r) => [r.playerName, r.points])).toEqual([
      ["Sam", 190],
      ["Alex", 180],
    ]);
    expect(table.rows[0].wins).toBe(1);
    expect(table.rows[1].played).toBe(2);
    expect(table.fixtures).toBe(2);
  });

  it("counts only the best N results when best-of is set, but shows them all", () => {
    const table = buildOrderOfMerit(
      [
        fixture("one", "2027-01-01", [{ playerId: "a", playerName: "Alex", position: 5 }]),
        fixture("two", "2027-02-01", [{ playerId: "a", playerName: "Alex", position: 1 }]),
        fixture("three", "2027-03-01", [{ playerId: "a", playerName: "Alex", position: 2 }]),
      ],
      "POSITION",
      2,
    );
    const row = table.rows[0];
    expect(row.played).toBe(3);
    expect(row.counting).toBe(2);
    expect(row.points).toBe(190); // 100 + 90, the 70 for 5th is dropped
    expect(row.results.filter((r) => r.counted)).toHaveLength(2);
    expect(row.results.find((r) => r.eventId === "one")?.counted).toBe(false);
  });

  it("can score a season on Stableford points instead", () => {
    const table = buildOrderOfMerit(
      [
        fixture("one", "2027-01-01", [
          { playerId: "a", playerName: "Alex", position: 2, stablefordPoints: 41 },
          { playerId: "b", playerName: "Sam", position: 1, stablefordPoints: 38 },
        ]),
        fixture("two", "2027-02-01", [
          { playerId: "a", playerName: "Alex", position: 1, stablefordPoints: 33 },
          { playerId: "b", playerName: "Sam", position: 2, stablefordPoints: 36 },
        ]),
      ],
      "STABLEFORD",
    );
    // 41+33 and 38+36 both make 74; the tie is broken on wins, then name.
    expect(table.rows.map((r) => r.points)).toEqual([74, 74]);
    expect(table.rows[0].playerId).toBe("a");
    expect(table.rows[0].wins).toBe(1);
  });

  it("shares a position when the total is level and sorts by wins", () => {
    const table = buildOrderOfMerit([
      fixture("one", "2027-01-01", [
        { playerId: "a", playerName: "Alex", position: 1 },
        { playerId: "b", playerName: "Sam", position: 1 },
      ]),
    ]);
    expect(table.rows.map((r) => r.position)).toEqual([1, 1]);
  });

  it("ignores a fixture nobody has started and players with no card", () => {
    const table = buildOrderOfMerit([
      fixture("draft", "2027-01-01", [{ playerId: "a", playerName: "Alex", position: 1, thru: 0 }]),
      fixture("played", "2027-02-01", [
        { playerId: "a", playerName: "Alex", position: 1 },
        { playerId: "b", playerName: "Sam", position: 2, thru: 0 },
      ]),
    ]);
    expect(table.fixtures).toBe(1);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].played).toBe(1);
  });

  it("credits every member of a scramble team with the team's result", () => {
    const table = buildOrderOfMerit([
      fixture("scramble", "2027-03-01", [
        { playerId: "a", playerName: "Alex", position: 1, team: true },
        { playerId: "b", playerName: "Sam", position: 1, team: true },
        { playerId: "c", playerName: "Priya", position: 2, team: true },
      ]),
    ]);
    expect(table.rows.map((r) => [r.playerName, r.position, r.points])).toEqual([
      ["Alex", 1, 100],
      ["Sam", 1, 100],
      ["Priya", 3, 90],
    ]);
    expect(table.rows[0].results[0].team).toBe(true);
  });

  it("survives an empty season", () => {
    const table = buildOrderOfMerit([]);
    expect(table.rows).toEqual([]);
    expect(table.fixtures).toBe(0);
  });
});
