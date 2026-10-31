export type Tee = {
  name: string;
  colour?: string;
  slope: number;
  rating: number;
  par: number;
  yardage?: number;
};

export const DEFAULT_TEE: Tee = { name: "White", colour: "white", slope: 113, rating: 72, par: 72 };

/**
 * WHS course handicap:
 *   courseHandicap = round(index * (slope / 113) + (rating - par))
 * (a plus handicap index, e.g. -1.4, correctly produces a negative result)
 */
export function courseHandicap(index: number, tee: Pick<Tee, "slope" | "rating" | "par">): number {
  const slope = tee.slope || 113;
  const rating = tee.rating ?? tee.par ?? 72;
  const par = tee.par ?? 72;
  return Math.round(index * (slope / 113) + (rating - par));
}

/** Playing handicap applies the event's handicap allowance (e.g. 95% for Stableford). */
export function playingHandicap(courseHcp: number, allowancePercent: number): number {
  return Math.round(courseHcp * (allowancePercent / 100));
}

/**
 * How many strokes a player receives on a hole, given the playing handicap and
 * the hole's stroke index. Handles handicaps above 18 (second/third round of
 * shots) and negative (plus) handicaps, which give a stroke back on the
 * easiest holes (stroke index 18, 17, ...).
 */
export function strokesReceived(handicap: number, strokeIndex: number): number {
  if (!Number.isFinite(handicap) || handicap === 0) return 0;
  const h = Math.trunc(handicap);
  if (h > 0) {
    const full = Math.floor(h / 18);
    const extra = h % 18;
    return full + (strokeIndex <= extra ? 1 : 0);
  }
  // plus handicaps: give strokes back starting at the lowest-rated (easiest) hole
  const back = Math.abs(h);
  const full = Math.floor(back / 18);
  const extra = back % 18;
  const given = full + (strokeIndex > 18 - extra ? 1 : 0);
  return given === 0 ? 0 : -given; // avoid -0
}

export function parseTees(raw: string | null | undefined): Tee[] {
  if (!raw) return [DEFAULT_TEE];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_TEE];
    return parsed.map((t: Partial<Tee>) => ({
      name: t.name ?? "White",
      colour: t.colour,
      slope: Number(t.slope) || 113,
      rating: Number(t.rating) || 72,
      par: Number(t.par) || 72,
      yardage: t.yardage,
    }));
  } catch {
    return [DEFAULT_TEE];
  }
}
