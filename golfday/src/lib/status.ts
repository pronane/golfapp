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
