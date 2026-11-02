/**
 * Flights (divisions).
 *
 * With a wide spread of handicaps one player wins by a distance and half the
 * field has nothing to play for. Every serious platform (PlayThru, Squabbit,
 * Golf Genius) splits the field into flights by handicap; this is the pure part,
 * so the split can be tested without a database.
 *
 * Players are sorted by playing handicap and cut into contiguous bands of as
 * near-equal size as the field allows, longest bands first. Nobody is moved
 * between flights once scores are in, because the split is derived from the
 * handicap each player was given on the day - it only changes if an organiser
 * changes a handicap.
 */

export type FlightBand = { index: number; name: string; playerIds: string[] };

export const MIN_FLIGHTS = 2;
export const MAX_FLIGHTS = 6;
/** Below this there is nothing to split. */
export const MIN_FIELD_FOR_FLIGHTS = 4;

/** Balanced contiguous bands: 19 players in 3 flights is 7/6/6, not 7/7/5. */
export function bandPlayers(
  rows: { playerId: string; playingHandicap: number; playerName?: string }[],
  count: number,
): FlightBand[] {
  if (!Number.isFinite(count)) return [];
  const flights = Math.floor(count);
  if (flights < MIN_FLIGHTS || rows.length < MIN_FIELD_FOR_FLIGHTS) return [];

  const sorted = [...rows].sort(
    (a, b) => a.playingHandicap - b.playingHandicap || (a.playerName ?? "").localeCompare(b.playerName ?? ""),
  );
  const base = Math.floor(sorted.length / flights);
  const extra = sorted.length % flights;

  const bands: FlightBand[] = [];
  let cursor = 0;
  for (let index = 0; index < flights; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    const slice = sorted.slice(cursor, cursor + size);
    cursor += size;
    bands.push({
      index,
      name: `Flight ${index + 1}`,
      playerIds: slice.map((row) => row.playerId),
    });
  }
  return bands.filter((band) => band.playerIds.length > 0);
}

/**
 * Splits the ranked rows into their flights.
 *
 * The caller re-ranks each band (so positions are per flight and countback
 * behaves exactly as it does on the main board); this only decides membership
 * and keeps the rows in the same object shape.
 */
export function splitIntoFlights<T extends { playerId: string }>(
  rows: T[],
  bands: FlightBand[],
): { name: string; index: number; rows: T[] }[] {
  const byId = new Map(rows.map((row) => [row.playerId, row]));
  return bands
    .map((band) => ({
      name: band.name,
      index: band.index,
      rows: band.playerIds.map((id) => byId.get(id)).filter((row): row is T => Boolean(row)),
    }))
    .filter((flight) => flight.rows.length > 0);
}

/** Clamp whatever an organiser sent into a number of flights the app supports. */
export function cleanFlightCount(value: unknown): number {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return 0;
  if (count < MIN_FLIGHTS) return 0;
  return Math.min(MAX_FLIGHTS, count);
}
