/**
 * How a player holds their handicap.
 *
 * The national database integration is only *one* way to have a handicap, and
 * plenty of golfers have none of it: no club, no England/Scottish/Welsh/Irish
 * membership, a subscriber-only iGolf index, a handicap from another country's
 * system, or a society/committee handicap that exists only on paper.
 *
 * So provenance is a property of the *player*, not of a club:
 *
 *   WHS / GOLF_ENGLAND  official, looked up on the national database
 *   IGOLF               England Golf's subscriber scheme - official, no club
 *   OVERSEAS            another country's system (GHIN, Golf Canada, Golf
 *                       Australia, ...) - official there, declared here
 *   SOCIETY             a society or committee handicap - real, but local
 *   MANUAL              typed in by the player or an organiser
 *   CSV / API           brought in by an import or an integration
 *   NONE                no handicap at all yet - plays off scratch until they
 *                       have one, and nothing blocks them entering a day
 *
 * Only a lookup can *verify* an index. Everything else is accepted as declared,
 * marked as such, and shown to the organiser - who can always override it.
 */
export type HandicapProvenance =
  | "WHS"
  | "GOLF_ENGLAND"
  | "IGOLF"
  | "OVERSEAS"
  | "SOCIETY"
  | "MANUAL"
  | "CSV"
  | "API"
  | "NONE";

export type ProvenanceMeta = {
  value: HandicapProvenance;
  label: string;
  short: string;
  blurb: string;
  /** Issued by a handicapping authority (whether or not we could verify it). */
  official: boolean;
  /** A national-database lookup can confirm it. */
  lookupable: boolean;
  /** Ask for a handicap ID (national ID, iGolf number, overseas number). */
  wantsId: boolean;
  notePlaceholder?: string;
};

export const PROVENANCES: ProvenanceMeta[] = [
  {
    value: "WHS",
    label: "National WHS database",
    short: "WHS",
    blurb: "England, Scotland, Wales or Ireland. Looked up and verified.",
    official: true,
    lookupable: true,
    wantsId: true,
    notePlaceholder: "Your CDH / member ID",
  },
  {
    value: "IGOLF",
    label: "iGolf (no club needed)",
    short: "iGolf",
    blurb: "England Golf's subscriber scheme for players without a club.",
    official: true,
    lookupable: false,
    wantsId: true,
    notePlaceholder: "Your iGolf number",
  },
  {
    value: "OVERSEAS",
    label: "Another country's system",
    short: "Overseas",
    blurb: "GHIN, Golf Canada, Golf Australia and so on. Verified when your society has that system's credentials.",
    official: true,
    lookupable: true,
    wantsId: true,
    notePlaceholder: "e.g. GHIN 1234567 (USA)",
  },
  {
    value: "SOCIETY",
    label: "Society or committee handicap",
    short: "Society",
    blurb: "A handicap your society or a committee maintains. Local, not WHS.",
    official: false,
    lookupable: false,
    wantsId: false,
    notePlaceholder: "Who maintains it (optional)",
  },
  {
    value: "MANUAL",
    label: "Entered by hand",
    short: "Manual",
    blurb: "You or an organiser typed the index in.",
    official: false,
    lookupable: false,
    wantsId: false,
    notePlaceholder: "Anything the organiser should know (optional)",
  },
  {
    value: "NONE",
    label: "No handicap yet",
    short: "No h'cap",
    blurb: "Play off scratch until you have one. Nothing is blocked.",
    official: false,
    lookupable: false,
    wantsId: false,
    notePlaceholder: "Optional - e.g. new player, first season",
  },
];

/** Provenances that only ever arrive from a lookup or an import. */
const DERIVED: ProvenanceMeta[] = [
  { value: "GOLF_ENGLAND", label: "National WHS database", short: "WHS", blurb: "Looked up on the national database.", official: true, lookupable: true, wantsId: true },
  { value: "CSV", label: "Imported from a CSV", short: "CSV", blurb: "Brought in with a club export.", official: false, lookupable: false, wantsId: false },
  { value: "API", label: "Brought in by an integration", short: "API", blurb: "Supplied by an integration.", official: false, lookupable: false, wantsId: false },
];

const ALL = [...PROVENANCES, ...DERIVED];
const BY_VALUE = new Map(ALL.map((meta) => [meta.value, meta]));

export function isHandicapProvenance(value: unknown): value is HandicapProvenance {
  return typeof value === "string" && BY_VALUE.has(value as HandicapProvenance);
}

/** Never throws: unknown or missing values read as `MANUAL`. */
export function provenanceMeta(value: string | null | undefined): ProvenanceMeta {
  return (value && BY_VALUE.get(value as HandicapProvenance)) || BY_VALUE.get("MANUAL")!;
}

/** Values a player or an organiser may pick directly in the UI. */
export const SELECTABLE_PROVENANCES = PROVENANCES;

/** True when the index came from a handicapping authority. */
export function isOfficialHandicap(value: string | null | undefined): boolean {
  return provenanceMeta(value).official;
}

/** True when a national-database lookup is the right way to set it. */
export function isLookupable(value: string | null | undefined): boolean {
  return provenanceMeta(value).lookupable;
}

/**
 * A lookup is the only thing that *verifies* an index, so provenance alone does
 * not make it verified - this is the flag the organiser sees.
 */
export function verifiedFor(value: string, lookedUp: boolean): boolean {
  return lookedUp && isLookupable(value);
}

/**
 * Maps whatever a lookup answered onto a stored provenance. The demo directory
 * is not a handicapping authority, so it records as MANUAL - which is why the
 * organiser still sees "not verified" for demo data.
 */
export function provenanceFromLookup(source: string): { source: HandicapProvenance; verified: boolean } {
  if (source === "WHS" || source === "GOLF_ENGLAND" || source === "CDH") return { source: "WHS", verified: true };
  // A real overseas database answered (GHIN, Golf Canada, Golf Australia).
  if (source === "OVERSEAS") return { source: "OVERSEAS", verified: true };
  return { source: "MANUAL", verified: false };
}

/** One line for a card or a table: "iGolf · 4.2 · declared". */
export function describeHandicap(input: {
  handicapIndex: number;
  handicapSource: string | null | undefined;
  handicapVerified?: boolean;
  handicapNote?: string | null;
}): string {
  const meta = provenanceMeta(input.handicapSource);
  if (meta.value === "NONE") return "No handicap yet · plays off 0";
  const state = input.handicapVerified ? "verified" : meta.official ? "declared" : "unofficial";
  const note = input.handicapNote?.trim();
  return `${meta.label} · ${input.handicapIndex.toFixed(1)} · ${state}${note ? ` · ${note}` : ""}`;
}
