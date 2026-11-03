/**
 * Every event format the app can actually run, in one place.
 *
 * The wizard used to offer three choices while the Games tab already knew how
 * to score gross skins, better-ball pairs and Ryder Cup match play - so an
 * organiser picking "Format" never saw them. This module is the catalogue: the
 * dropdowns, the ranking engine, the handicap allowance and the Games-tab
 * preset all derive from it, so a new format is added here (plus its label)
 * instead of being sprinkled through a dozen `format === "..."` checks.
 *
 * Two layers, deliberately:
 *
 *   - `boardFormat` is how the MAIN table ranks - Stableford points or net
 *     stroke play. Every individual format maps onto one of those two engines;
 *     a Texas scramble has no individual table at all.
 *   - `gamesPreset` is what the Games tab gets switched on for formats whose
 *     extra board (pairs, match play, skins) is the whole point of the day.
 *     The Games tab remains the live editor afterwards.
 *
 * Gross formats are not a separate scoring path: they are the same engine with
 * the handicap allowance pinned to zero, which is exactly what "gross" means.
 * `effectiveAllowance` is the one place that rule lives, so a stored allowance
 * can never quietly turn a gross day into a net one.
 */

export const EVENT_FORMATS = [
  "STABLEFORD",
  "STROKE_PLAY",
  "GROSS_STABLEFORD",
  "GROSS_STROKE_PLAY",
  "TEXAS_SCRAMBLE",
  "FOUR_BETTER_BALL",
  "RYDER_CUP",
  "SKINS_NET",
  "SKINS_GROSS",
] as const;

export type EventFormat = (typeof EVENT_FORMATS)[number];

/** The two engines that can rank an individual board. */
export type BoardFormat = "STABLEFORD" | "STROKE_PLAY";

export function isEventFormat(value: unknown): value is EventFormat {
  return typeof value === "string" && (EVENT_FORMATS as readonly string[]).includes(value);
}

/**
 * Which ranking engine scores the main table.
 *
 * Stroke-based formats (net stroke, gross stroke, skins days) rank by net to
 * par; everything else ranks by Stableford points. A scramble is guarded by its
 * callers - it has no individual standings - and falls through to Stableford.
 */
export function boardFormat(format: string): BoardFormat {
  switch (format) {
    case "STROKE_PLAY":
    case "GROSS_STROKE_PLAY":
    case "SKINS_NET":
    case "SKINS_GROSS":
      return "STROKE_PLAY";
    default:
      return "STABLEFORD";
  }
}

/** Does the main table show Stableford points (rather than net to par)? */
export function isStablefordBoard(format: string): boolean {
  return boardFormat(format) === "STABLEFORD";
}

/** Formats played with no handicap allowance at all - what "gross" means. */
const GROSS_FORMATS = new Set<string>(["GROSS_STABLEFORD", "GROSS_STROKE_PLAY", "SKINS_GROSS"]);

export function isGrossFormat(format: string): boolean {
  return GROSS_FORMATS.has(format);
}

/**
 * The allowance the engine must actually use.
 *
 * The stored value stays whatever the organiser last set (so switching a day
 * from gross to net and back restores their number), but a gross format always
 * plays off zero shots - a gross day that quietly received 95% would be a
 * different competition from the one on the noticeboard.
 */
export function effectiveAllowance(format: string, stored: number): number {
  return isGrossFormat(format) ? 0 : stored;
}

/**
 * The human name of an event's format, in one place.
 *
 * The fixture list used to print "Stroke play" for anything that was not
 * Stableford, so a Texas scramble was labelled as stroke play on the very page
 * strangers see first. Every surface that names a format should call this.
 */
export function formatLabel(format: string): string {
  switch (format) {
    case "STABLEFORD":
      return "Stableford";
    case "STROKE_PLAY":
      return "Stroke play";
    case "GROSS_STABLEFORD":
      return "Stableford (gross)";
    case "GROSS_STROKE_PLAY":
      return "Stroke play (gross)";
    case "TEXAS_SCRAMBLE":
      return "Texas scramble";
    case "FOUR_BETTER_BALL":
      return "Better-ball pairs (4BBB)";
    case "RYDER_CUP":
      return "Ryder Cup match play";
    case "SKINS_NET":
      return "Skins (net)";
    case "SKINS_GROSS":
      return "Skins (gross)";
    default:
      return format;
  }
}

/** The allowance sentence shown next to a format on pills and review rows. */
export function allowanceLabel(format: string, stored: number): string {
  if (format === "TEXAS_SCRAMBLE") return `${stored}% scramble allowance`;
  if (isGrossFormat(format)) return "gross · no allowance";
  return `${effectiveAllowance(format, stored)}% allowance`;
}

/** Review-row text: "Stableford (gross) · gross · no allowance" reads badly,
 *  so the two halves are composed once, here. */
export function formatSummary(format: string, stored: number): string {
  return `${formatLabel(format)} · ${allowanceLabel(format, stored)}`;
}

/**
 * What the Games tab should be switched to when a day is created (or its
 * format changed) as this format.
 *
 * Partial on purpose: `cleanSettings` fills everything else with the defaults,
 * so callers merge this over the current settings when the event already has
 * games configured (side games, sponsors, entry fee) they want to keep.
 */
export function gamesPreset(format: string): { teamFormat: "NONE" | "FOURBBB" | "MATCHPLAY"; skins: "OFF" | "NET" | "GROSS" } {
  switch (format) {
    case "FOUR_BETTER_BALL":
      return { teamFormat: "FOURBBB", skins: "OFF" };
    case "RYDER_CUP":
      return { teamFormat: "MATCHPLAY", skins: "OFF" };
    case "SKINS_NET":
      return { teamFormat: "NONE", skins: "NET" };
    case "SKINS_GROSS":
      return { teamFormat: "NONE", skins: "GROSS" };
    default:
      return { teamFormat: "NONE", skins: "OFF" };
  }
}

/** Does this format need the Games tab touched at all on creation? */
export function hasGamesPreset(format: string): boolean {
  const preset = gamesPreset(format);
  return preset.teamFormat !== "NONE" || preset.skins !== "OFF";
}
