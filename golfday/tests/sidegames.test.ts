import { describe, expect, it } from "vitest";
import { summariseRound } from "@/lib/scoring";
import {
  autoPairs,
  computeMatch,
  computeSkins,
  formatDistance,
  rankFourBall,
  sideGameLeaders,
  teamMatchBoard,
  type CardForGames,
  type MatchCard,
} from "@/lib/sidegames";

const holes = Array.from({ length: 4 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));
const card = (id: string, strokes: (number | null)[], hcp = 0): CardForGames => {
  const total = summariseRound(
    holes,
    strokes.flatMap((s, i) => (s === null ? [] : [{ holeNumber: i + 1, strokes: s }])),
    hcp,
  );
  return { playerId: id, playerName: id, thru: total.holesPlayed, holeResults: total.results };
};

describe("skins", () => {
  it("awards outright wins and carries halved holes", () => {
    const cards = [card("Ann", [4, 4, 3, 5]), card("Bob", [4, 5, 4, 4]), card("Cat", [5, 4, 5, 5])];
    const r = computeSkins(cards, [1, 2, 3, 4], "GROSS");
    // hole 1 halved (Ann/Bob 4), hole 2 halved (Ann/Cat 4) -> hole 3 worth 3 to Ann, hole 4 to Bob
    expect(r.holes.map((h) => h.status)).toEqual(["carried", "carried", "won", "won"]);
    expect(r.holes[2].value).toBe(3);
    expect(r.totals).toEqual([
      { playerId: "Ann", playerName: "Ann", skins: 3 },
      { playerId: "Bob", playerName: "Bob", skins: 1 },
    ]);
    expect(r.carryingOver).toBe(0);
  });

  it("uses net scores in net mode", () => {
    // Bob gets a shot on SI 1 (hcp 1): gross 5 = net 4 halves with Ann's 4
    const cards = [card("Ann", [4, 4, 4, 4]), card("Bob", [5, 3, 4, 4], 1)];
    const r = computeSkins(cards, [1, 2, 3, 4], "NET");
    expect(r.holes[0].status).toBe("carried");
    expect(r.holes[1].winnerId).toBe("Bob");
    expect(r.holes[1].value).toBe(2);
  });

  it("leaves a hole open until everyone who has started has scored it", () => {
    const cards = [card("Ann", [4, 3, null, null]), card("Bob", [5, null, null, null])];
    const r = computeSkins(cards, [1, 2, 3, 4], "GROSS");
    expect(r.holes.map((h) => h.status)).toEqual(["won", "open", "open", "open"]);
    expect(r.totals).toEqual([{ playerId: "Ann", playerName: "Ann", skins: 1 }]);
  });

  it("reports skins still riding at the end", () => {
    const cards = [card("Ann", [4, 4, 4, 4]), card("Bob", [4, 4, 4, 4])];
    expect(computeSkins(cards, [1, 2, 3, 4], "GROSS").carryingOver).toBe(4);
    expect(computeSkins(cards, [1, 2, 3, 4], "GROSS", false).carryingOver).toBe(0);
  });
});

describe("4BBB", () => {
  it("takes the better partner's points on each hole", () => {
    const cards = [card("Ann", [4, 6, 4, 4]), card("Bob", [6, 3, 5, 5]), card("Cat", [5, 5, 5, 5]), card("Dan", [5, 5, 3, null])];
    const ranked = rankFourBall(
      [
        { id: "p1", name: "Ann & Bob", playerIds: ["Ann", "Bob"] },
        { id: "p2", name: "Cat & Dan", playerIds: ["Cat", "Dan"] },
      ],
      cards,
    );
    // Ann&Bob: 2,3,2,2 = 9 ; Cat&Dan: 1,1,3,1 = 6
    expect(ranked.map((r) => [r.name, r.points])).toEqual([["Ann & Bob", 9], ["Cat & Dan", 6]]);
    expect(ranked[0].position).toBe(1);
  });

  it("pairs each tee group in order", () => {
    expect(autoPairs([{ id: "g1", name: "Group 1", playerIds: ["a", "b", "c", "d", "e"] }, { id: "g2", name: "Group 2", playerIds: ["f", "g"] }])).toEqual([
      { name: "Group 1 · pair 1", playerIds: ["a", "b"] },
      { name: "Group 1 · pair 2", playerIds: ["c", "d"] },
      { name: "Group 2", playerIds: ["f", "g"] },
    ]);
  });
});

describe("nearest the pin / longest drive", () => {
  it("picks the closest and the longest", () => {
    const leaders = sideGameLeaders(
      [{ kind: "NEAREST_PIN", holeNumber: 7 }, { kind: "LONGEST_DRIVE", holeNumber: 12 }, { kind: "NEAREST_PIN", holeNumber: 16 }],
      [
        { kind: "NEAREST_PIN", holeNumber: 7, playerId: "a", playerName: "Ann", distance: 6.5 },
        { kind: "NEAREST_PIN", holeNumber: 7, playerId: "b", playerName: "Bob", distance: 3.25 },
        { kind: "LONGEST_DRIVE", holeNumber: 12, playerId: "a", playerName: "Ann", distance: 251 },
        { kind: "LONGEST_DRIVE", holeNumber: 12, playerId: "b", playerName: "Bob", distance: 287 },
      ],
    );
    expect(leaders.map((l) => l.leader?.playerName ?? null)).toEqual(["Bob", "Bob", null]);
    expect(formatDistance("NEAREST_PIN", 3.25)).toBe("3ft 3in");
    expect(formatDistance("NEAREST_PIN", 4)).toBe("4ft");
    expect(formatDistance("LONGEST_DRIVE", 287.4)).toBe("287 yd");
  });
});

describe("team match play", () => {
  const card18 = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, strokeIndex: i + 1 }));
  const mc = (id: string, strokes: number[], hcp = 0): MatchCard => ({
    playerId: id,
    playerName: id,
    playingHandicap: hcp,
    strokes: new Map(strokes.map((s, i) => [i + 1, s])),
  });

  it("closes out a singles match early (3&2)", () => {
    const cards = new Map([
      ["Ann", mc("Ann", [3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])],
      ["Bob", mc("Bob", [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])],
    ]);
    const r = computeMatch({ id: "m1", name: "M1", sideA: ["Ann"], sideB: ["Bob"] }, cards, card18);
    expect(r.finished).toBe(true);
    expect(r.status).toBe("3&2");
    expect(r.points).toEqual({ A: 1, B: 0 });
  });

  it("gives strokes off the low handicap on the hardest holes", () => {
    // Bob plays off 2 more than Ann: shots on SI 1 and 2 turn his 5s into net 4s.
    const ann = mc("Ann", [4, 4, 4]);
    const bob = mc("Bob", [5, 5, 4], 12);
    const annHcp = { ...ann, playingHandicap: 10 };
    const cards = new Map([["Ann", annHcp], ["Bob", bob]]);
    const r = computeMatch({ id: "m", name: "M", sideA: ["Ann"], sideB: ["Bob"] }, cards, card18);
    expect(r.holesPlayed).toBe(3);
    expect(r.status).toBe("AS thru 3");
  });

  it("uses the better ball in fourball and waits for every score", () => {
    const cards = new Map([
      ["A1", mc("A1", [5, 3])],
      ["A2", mc("A2", [4])],
      ["B1", mc("B1", [5, 4])],
      ["B2", mc("B2", [5, 4])],
    ]);
    const r = computeMatch({ id: "m", name: "M", sideA: ["A1", "A2"], sideB: ["B1", "B2"] }, cards, card18);
    // hole 1: A best 4 vs B 5 -> A 1 UP; hole 2 not counted (A2 hasn't scored)
    expect(r.holesPlayed).toBe(1);
    expect(r.status).toBe("1 UP thru 1");
    expect(r.leading).toBe("A");
  });

  it("totals banked and projected team points", () => {
    const cards = new Map([
      ["Ann", mc("Ann", Array(18).fill(4))],
      ["Bob", mc("Bob", Array(18).fill(4))],
      ["Cat", mc("Cat", [3])],
      ["Dan", mc("Dan", [4])],
    ]);
    const board = teamMatchBoard(
      ["Europe", "USA"],
      [
        { id: "1", name: "1", sideA: ["Ann"], sideB: ["Bob"] },
        { id: "2", name: "2", sideA: ["Cat"], sideB: ["Dan"] },
      ],
      cards,
      card18,
    );
    expect(board.matches[0].status).toBe("Halved");
    expect(board.banked).toEqual({ A: 0.5, B: 0.5 });
    expect(board.projected).toEqual({ A: 1.5, B: 0.5 });
    expect(board.toWin).toBe(1.5);
  });
});
