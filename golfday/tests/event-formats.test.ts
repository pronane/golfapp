/**
 * The format catalogue.
 *
 * Nine formats were promised to the wizard's dropdown; the risk is not the
 * list itself but the wiring - a format whose board ranks by the wrong engine,
 * a gross day that quietly hands out shots, a Ryder Cup created without its
 * match board. These are the contracts that keep those from happening:
 *
 *   - every format has a human label, and `status.formatLabel` is the same one
 *     (one label, two doors - drift between them is a bug);
 *   - `boardFormat` says which ranking engine owns the main table;
 *   - gross formats always play off zero allowance;
 *   - `gamesPreset` switches on the Games-tab board the format implies;
 *   - the API accepts every format in the catalogue and nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  EVENT_FORMATS,
  allowanceLabel,
  boardFormat,
  effectiveAllowance,
  formatLabel,
  formatSummary,
  gamesPreset,
  hasGamesPreset,
  isGrossFormat,
  isStablefordBoard,
} from "@/lib/eventFormats";
import { formatLabel as statusFormatLabel } from "@/lib/status";
import { createEventSchema, updateEventSchema } from "@/lib/validate";

describe("the catalogue", () => {
  it("is the nine formats the dropdown offers", () => {
    expect([...EVENT_FORMATS]).toEqual([
      "STABLEFORD",
      "STROKE_PLAY",
      "GROSS_STABLEFORD",
      "GROSS_STROKE_PLAY",
      "TEXAS_SCRAMBLE",
      "FOUR_BETTER_BALL",
      "RYDER_CUP",
      "SKINS_NET",
      "SKINS_GROSS",
    ]);
  });

  it("labels every format, and status.formatLabel says the same thing", () => {
    for (const format of EVENT_FORMATS) {
      expect(formatLabel(format)).not.toBe("");
      expect(statusFormatLabel(format)).toBe(formatLabel(format));
    }
    expect(formatLabel("STABLEFORD")).toBe("Stableford"); // the old contracts
    expect(formatLabel("TEXAS_SCRAMBLE")).toBe("Texas scramble");
    expect(formatLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW"); // unknown ids show through
  });

  it("accepts every format at the API and rejects what we cannot score", () => {
    for (const format of EVENT_FORMATS) {
      const parsed = createEventSchema.safeParse({
        name: "Test day",
        date: "2026-06-06",
        format,
      });
      expect(parsed.success, `create should accept ${format}`).toBe(true);
      expect(updateEventSchema.safeParse({ format }).success).toBe(true);
    }
    expect(createEventSchema.safeParse({ name: "Test day", date: "2026-06-06", format: "MATCH_PLAY" }).success).toBe(false);
    expect(createEventSchema.safeParse({ name: "Test day", date: "2026-06-06", format: "FOURSOMES" }).success).toBe(false);
  });
});

describe("which engine ranks the board", () => {
  it("sends stroke-family formats to net stroke play", () => {
    for (const format of ["STROKE_PLAY", "GROSS_STROKE_PLAY", "SKINS_NET", "SKINS_GROSS"]) {
      expect(boardFormat(format)).toBe("STROKE_PLAY");
      expect(isStablefordBoard(format)).toBe(false);
    }
  });

  it("sends everything else - including the team formats - to Stableford points", () => {
    for (const format of ["STABLEFORD", "GROSS_STABLEFORD", "FOUR_BETTER_BALL", "RYDER_CUP", "TEXAS_SCRAMBLE"]) {
      expect(boardFormat(format)).toBe("STABLEFORD");
      expect(isStablefordBoard(format)).toBe(true);
    }
  });
});

describe("gross means no shots, ever", () => {
  it("knows which formats are gross", () => {
    expect(isGrossFormat("GROSS_STABLEFORD")).toBe(true);
    expect(isGrossFormat("GROSS_STROKE_PLAY")).toBe(true);
    expect(isGrossFormat("SKINS_GROSS")).toBe(true);
    expect(isGrossFormat("STABLEFORD")).toBe(false);
    expect(isGrossFormat("SKINS_NET")).toBe(false);
  });

  it("pins the effective allowance to zero whatever is stored", () => {
    expect(effectiveAllowance("GROSS_STROKE_PLAY", 95)).toBe(0);
    expect(effectiveAllowance("GROSS_STABLEFORD", 0)).toBe(0);
    expect(effectiveAllowance("STROKE_PLAY", 95)).toBe(95);
    expect(effectiveAllowance("SKINS_NET", 90)).toBe(90);
  });

  it("says so on the pills", () => {
    expect(allowanceLabel("GROSS_STABLEFORD", 95)).toBe("gross · no allowance");
    expect(allowanceLabel("STABLEFORD", 95)).toBe("95% allowance");
    expect(formatSummary("GROSS_STROKE_PLAY", 95)).toBe("Stroke play (gross) · gross · no allowance");
  });
});

describe("games presets", () => {
  it("switches on the board each format implies", () => {
    expect(gamesPreset("FOUR_BETTER_BALL")).toEqual({ teamFormat: "FOURBBB", skins: "OFF" });
    expect(gamesPreset("RYDER_CUP")).toEqual({ teamFormat: "MATCHPLAY", skins: "OFF" });
    expect(gamesPreset("SKINS_NET")).toEqual({ teamFormat: "NONE", skins: "NET" });
    expect(gamesPreset("SKINS_GROSS")).toEqual({ teamFormat: "NONE", skins: "GROSS" });
  });

  it("leaves plain formats at the defaults", () => {
    for (const format of ["STABLEFORD", "STROKE_PLAY", "GROSS_STABLEFORD", "GROSS_STROKE_PLAY", "TEXAS_SCRAMBLE"]) {
      expect(gamesPreset(format)).toEqual({ teamFormat: "NONE", skins: "OFF" });
      expect(hasGamesPreset(format)).toBe(false);
    }
    expect(hasGamesPreset("RYDER_CUP")).toBe(true);
    expect(hasGamesPreset("SKINS_NET")).toBe(true);
  });
});
