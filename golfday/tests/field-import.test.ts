/**
 * The "Dave" parser.
 *
 * An organiser pastes the field out of a WhatsApp message. These tests are the
 * contract: what people actually type, what must never be silently dropped, and
 * the handful of things that must be refused rather than guessed.
 */
import { describe, expect, it } from "vitest";
import { parsePlayerList } from "@/lib/fieldImport";

const names = (text: string) => parsePlayerList(text).players.map((p) => p.name);

describe("reading a pasted field", () => {
  it("reads one name per line, with or without a handicap", () => {
    const { players, problems } = parsePlayerList(`Dave Smith 12.4
Priya Raman
Tom Beresford 8`);

    expect(problems).toEqual([]);
    expect(players.map((p) => [p.name, p.handicap])).toEqual([
      ["Dave Smith", 12.4],
      ["Priya Raman", null],
      ["Tom Beresford", 8],
    ]);
  });

  it("accepts every separator an organiser actually types", () => {
    expect(parsePlayerList("Dave Smith, 12.4").players[0]).toMatchObject({ name: "Dave Smith", handicap: 12.4 });
    expect(parsePlayerList("Dave Smith - 12.4").players[0]).toMatchObject({ name: "Dave Smith", handicap: 12.4 });
    expect(parsePlayerList("Dave Smith (12.4)").players[0]).toMatchObject({ name: "Dave Smith", handicap: 12.4 });
    expect(parsePlayerList("Dave Smith 12,4").players[0]).toMatchObject({ name: "Dave Smith", handicap: 12.4 });
    expect(parsePlayerList("Dave Smith: 12.4").players[0]).toMatchObject({ name: "Dave Smith", handicap: 12.4 });
    expect(parsePlayerList("Dave Smith 12.4,").players[0]).toMatchObject({ name: "Dave Smith", handicap: 12.4 });
  });

  it("keeps plus handicaps and refuses nonsense ones", () => {
    expect(parsePlayerList("Sam Whitcombe +1.2").players[0]).toMatchObject({ name: "Sam Whitcombe", handicap: 1.2 });
    const { players, problems } = parsePlayerList("Old Bandit 99");
    expect(players).toHaveLength(0);
    expect(problems[0].reason).toMatch(/outside/);
  });

  it("strips the numbering and bullets a copied list arrives with", () => {
    expect(names("1. Dave Smith 12.4\n2. Priya Raman 5\n- Tom Beresford\n• Ella Fitzpatrick")).toEqual([
      "Dave Smith",
      "Priya Raman",
      "Tom Beresford",
      "Ella Fitzpatrick",
    ]);
  });

  it("reads a third field as the home club, so a real CSV still works", () => {
    const player = parsePlayerList("Dave Smith,12.4,Harrow GC").players[0];
    expect(player).toMatchObject({ name: "Dave Smith", handicap: 12.4, club: "Harrow GC" });
  });

  it("skips a pasted spreadsheet header", () => {
    expect(names("Name,Handicap\nDave Smith,12.4")).toEqual(["Dave Smith"]);
  });

  it("keeps names with hyphens, apostrophes and accents intact", () => {
    expect(names("Jean-Luc O'Brien 4.2\nCallum Ó Dálaigh 3.6")).toEqual(["Jean-Luc O'Brien", "Callum Ó Dálaigh"]);
  });

  it("refuses a line that is only a number", () => {
    const { players, problems } = parsePlayerList("12.4");
    expect(players).toEqual([]);
    expect(problems[0].reason).toMatch(/not look like a name/);
  });
});

describe("refusing rather than guessing", () => {
  it("reports a duplicate name instead of adding the same golfer twice", () => {
    const { players, problems } = parsePlayerList("Dave Smith 12.4\ndave smith 12.4");
    expect(players).toHaveLength(1);
    expect(problems[0].reason).toMatch(/already in the list/);
  });

  it("reports a line it cannot read, and still takes the rest", () => {
    const { players, problems } = parsePlayerList("Dave Smith 12.4\n!!!\nPriya Raman 5");
    expect(players.map((p) => p.name)).toEqual(["Dave Smith", "Priya Raman"]);
    expect(problems).toHaveLength(1);
    expect(problems[0].lineNumber).toBe(2);
  });

  it("ignores blank lines and carriage returns", () => {
    expect(names("Dave Smith\r\n\r\nPriya Raman\r\n")).toEqual(["Dave Smith", "Priya Raman"]);
  });

  it("returns nothing at all for an empty paste", () => {
    expect(parsePlayerList("   \n\n  ")).toEqual({ players: [], problems: [] });
  });
});
