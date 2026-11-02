// Client-safe labels/styles for event statuses (no database imports here).
export const EVENT_STATUSES = ["DRAFT", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open for entries",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  OPEN: "bg-fairway-50 text-fairway-700 ring-fairway-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-200",
  COMPLETED: "bg-ink/5 text-ink/70 ring-ink/10",
  CANCELLED: "bg-rose-50 text-rose-700 ring-rose-200",
};

/**
 * May this person write to a card at all?
 *
 * A draft or a cancelled golf day takes no scores from anybody. A completed one
 * is shut to the field - no group link, no player - but the organiser can still
 * amend a card, because a wrong number still has to be fixable after the prizes
 * are handed out. Every organiser change is written to `score_audit`.
 *
 * Kept here (client-safe, no database) so the rule is stated once and can be
 * unit tested, rather than being repeated inside two route handlers. `status` is
 * a plain string because it arrives from the database row.
 */
export type ScoreWriteRule = { allowed: true } | { allowed: false; code: string; message: string };

export function scoreWriteRule(status: string, isAdmin: boolean): ScoreWriteRule {
  if (status === "DRAFT" || status === "CANCELLED") {
    return { allowed: false, code: "event_closed", message: "Scoring is not open for this event" };
  }
  if (status === "COMPLETED" && !isAdmin) {
    return { allowed: false, code: "event_completed", message: "This event is complete - scores are locked" };
  }
  return { allowed: true };
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
    case "TEXAS_SCRAMBLE":
      return "Texas scramble";
    default:
      return format;
  }
}

/** Whether the format is scored as one card per team. */
export function isTeamFormat(format: string): boolean {
  return format === "TEXAS_SCRAMBLE";
}
