/**
 * Scores entered with no signal (common out on the course) are kept on the
 * phone and sent when the connection comes back. One entry per player/hole -
 * the latest tap wins - stored per scoring link in localStorage.
 */
export type QueuedScore = {
  eventId: string;
  playerId: string;
  holeNumber: number;
  strokes: number;
  token: string;
  /** Which round of a multi-round event (absent = round 1). */
  round?: number;
};

const key = (token: string) => `golfday:queue:${token}`;
const memoryQueues = new Map<string, QueuedScore[]>();
const activeFlushes = new Map<string, Promise<{ sent: number; rejected: string[]; left: number }>>();

export function readQueue(token: string): QueuedScore[] {
  const cached = memoryQueues.get(token);
  if (typeof window === "undefined") return cached ?? [];
  try {
    const raw = window.localStorage.getItem(key(token));
    if (!raw) return cached ?? [];
    const parsed = JSON.parse(raw) as QueuedScore[];
    if (!Array.isArray(parsed)) return cached ?? [];
    memoryQueues.set(token, parsed);
    return parsed;
  } catch {
    return cached ?? [];
  }
}

function writeQueue(token: string, queue: QueuedScore[]): boolean {
  memoryQueues.set(token, queue);
  if (typeof window === "undefined") return false;
  try {
    if (queue.length === 0) window.localStorage.removeItem(key(token));
    else window.localStorage.setItem(key(token), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

export function enqueue(item: QueuedScore): boolean {
  const queue = readQueue(item.token).filter(
    (q) =>
      !(
        q.playerId === item.playerId &&
        q.holeNumber === item.holeNumber &&
        (q.round ?? 1) === (item.round ?? 1)
      ),
  );
  return writeQueue(item.token, [...queue, item]);
}

export function dropFromQueue(token: string, playerId: string, holeNumber: number, round = 1, strokes?: number) {
  writeQueue(
    token,
    readQueue(token).filter(
      (q) =>
        !(
          q.playerId === playerId &&
          q.holeNumber === holeNumber &&
          (q.round ?? 1) === round &&
          (strokes === undefined || q.strokes === strokes)
        ),
    ),
  );
}

/**
 * Sends queued scores in order. Network and server errors remain queued for a
 * retry; permanent client errors are reported and removed so they do not block
 * later scores.
 */
export async function flushQueue(token: string): Promise<{ sent: number; rejected: string[]; left: number }> {
  const active = activeFlushes.get(token);
  if (active) return active;

  const flushing = flushQueueOnce(token);
  activeFlushes.set(token, flushing);
  try {
    return await flushing;
  } finally {
    if (activeFlushes.get(token) === flushing) activeFlushes.delete(token);
  }
}

async function flushQueueOnce(token: string): Promise<{ sent: number; rejected: string[]; left: number }> {
  const rejected: string[] = [];
  let sent = 0;
  for (const item of readQueue(token)) {
    let res: Response;
    try {
      res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
    } catch {
      break;
    }
    if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) break;
    if (res.ok) {
      sent += 1;
    } else {
      const data = await res.json().catch(() => ({}));
      rejected.push(`Hole ${item.holeNumber}: ${data.error ?? "rejected"}`);
    }
    dropFromQueue(token, item.playerId, item.holeNumber, item.round ?? 1, item.strokes);
  }
  return { sent, rejected, left: readQueue(token).length };
}
