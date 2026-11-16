/**
 * Turning a WhatsApp message into a field.
 *
 * This is the "Dave" path: a 60-something organiser has the names in a message
 * on his phone, or a note in his diary, or a row of the club's booking sheet. He
 * is not going to fill in a form nineteen times, and he is certainly not going to
 * open Excel and export a CSV.
 *
 * So: one text box, one line per player, and a parser that is deliberately
 * forgiving about what people actually type:
 *
 *   Dave Smith 12.4            Dave Smith, 12.4          Dave Smith - 12.4
 *   Dave Smith (12.4)          Dave Smith +1.2           1. Dave Smith 12.4
 *   - Dave Smith 12.4          Dave Smith 12,4           Dave Smith 12.4, Harrow GC
 *   Dave Smith                 (no handicap at all - scratch)
 *
 * Anything it cannot read is reported back line by line, never silently dropped,
 * because a missing player on a Saturday is worse than an ugly error message.
 */

export type ParsedPlayer = {
  /** The name as typed, trimmed and with the numbering/bullet stripped. */
  name: string;
  /** Handicap index, or null when the line only had a name. */
  handicap: number | null;
  /** Optional home club, if a third comma-separated field was given. */
  club: string | null;
  /** The original line, for reporting. */
  line: string;
  /** Line number in the pasted text, 1-based. */
  lineNumber: number;
};

export type ParseProblem = { lineNumber: number; line: string; reason: string };

export type ParsedField = { players: ParsedPlayer[]; problems: ParseProblem[] };

/** Handicaps outside this are a typo, not a golfer. */
const MIN_HANDICAP = -10;
const MAX_HANDICAP = 54;

/** "12,4" is a comma decimal, not a list separator - both are typos people make. */
const normaliseNumber = (raw: string) => Number(raw.replace(",", "."));

/**
 * A handicap at the end of the line: 12, 12.4, +1.2, -2, (12.4), "12.4," etc.
 * Anchored to the end so that "Smith-Jones 12.4" keeps its name intact.
 */
const TRAILING_HANDICAP = /^(.*?)[\s,;:=-]*\(?([+-]?\d{1,2}(?:[.,]\d)?)\)?\s*$/;

function stripBullet(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·]|\d{1,3}[.)])\s+/, "") // - , * , • , 1. , 2)
    .replace(/^\s*\(\d{1,3}\)\s+/, "") // (1)
    .trim();
}

/** "Dave Smith, 12.4, Harrow GC" -> name + handicap + club. */
function splitCommaFields(line: string): string[] {
  return line.split(/\s*,\s*/).filter((part) => part.length > 0);
}

export function parsePlayerList(text: string): ParsedField {
  const players: ParsedPlayer[] = [];
  const problems: ParseProblem[] = [];
  const seen = new Set<string>();

  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const original = rawLine.trim();
    if (original.length === 0) return;

    // A header row pasted from a spreadsheet is not a player.
    if (index === 0 && /^(name|player|golfer)\b/i.test(original) && /handicap|\bh\.?i\.?\b|hcp/i.test(original)) return;

    const cleaned = stripBullet(original);
    if (cleaned.length === 0) return;

    let name = "";
    let handicap: number | null = null;
    let club: string | null = null;

    // "12,4" is a comma decimal before it is a separator: join it up first, so
    // "Dave Smith 12,4" does not become a player called "Dave Smith 12".
    const fields = splitCommaFields(cleaned.replace(/(\d),(\d)/g, "$1.$2"));
    if (fields.length >= 2) {
      // Comma-separated: name, handicap[, club]. If the second field is not a
      // number, treat the whole line as "name + maybe handicap" instead - people
      // write "Smith, Dave 12.4" too.
      const maybeHandicap = fields[1].replace(/[^\d+.,-]/g, "");
      if (maybeHandicap && Number.isFinite(normaliseNumber(maybeHandicap))) {
        name = fields[0].trim();
        handicap = normaliseNumber(maybeHandicap);
        club = fields.length >= 3 ? fields.slice(2).join(", ").trim() || null : null;
      }
    }

    if (!name) {
      // A trailing comma or dash is punctuation, not part of the handicap.
      const match = TRAILING_HANDICAP.exec(cleaned.replace(/[\s,;:-]+$/, ""));
      const candidate = match?.[2];
      if (match && candidate !== undefined && /\d/.test(candidate)) {
        const value = normaliseNumber(candidate);
        const rest = match[1].trim().replace(/[\s,;:=-]+$/, "");
        // "12.4" alone, or "Dave" alone: no handicap, just a name.
        if (rest.length > 0 && Number.isFinite(value)) {
          name = rest;
          handicap = value;
        } else {
          name = cleaned;
        }
      } else {
        name = cleaned;
      }
    }

    name = name.replace(/\s+/g, " ").trim();

    if (name.length < 2) {
      problems.push({ lineNumber, line: original, reason: "no name on this line" });
      return;
    }
    if (!/[a-z]/i.test(name)) {
      problems.push({ lineNumber, line: original, reason: "that does not look like a name" });
      return;
    }
    if (handicap !== null && (handicap < MIN_HANDICAP || handicap > MAX_HANDICAP)) {
      problems.push({ lineNumber, line: original, reason: `handicap ${handicap} is outside ${MIN_HANDICAP} to ${MAX_HANDICAP}` });
      return;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      problems.push({ lineNumber, line: original, reason: `${name} is already in the list` });
      return;
    }
    seen.add(key);

    players.push({ name, handicap, club, line: original, lineNumber });
  });

  return { players, problems };
}
