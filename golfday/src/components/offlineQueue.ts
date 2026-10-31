/**
 * Scores entered with no signal (common out on the course) are kept on the
 * phone and sent when the connection comes back. One entry per player/hole -
 * the latest tap wins - stored per scoring link in localStorage.
 */
export type QueuedScore = { eventId: string; playerId: string; holeNumber: number; strokes: number; token: string };

const key = (token: string) => `golfday:queue:${token}`;

export function readQueue(token: string): QueuedScore[] {
  try {
    const raw = window.localStorage.getItem(key(token));
    const parsed = raw ? (JSON.parse(raw) as QueuedScore[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(token: string, queue: QueuedScore[]) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(key(token));
    else window.localStorage.setItem(key(token), JSON.stringify(queue));
  } catch {
    /* storage full or blocked - the score stays in memory for this visit */
  }
}

export function enqueue(item: QueuedScore) {
  const queue = readQueue(item.token).filter(
    (q) => !(q.playerId === item.playerId && q.holeNumber === item.holeNumber),
  );
  writeQueue(item.token, [...queue, item]);
}

export function dropFromQueue(token: string, playerId: string, holeNumber: number) {
  writeQueue(
    token,
    readQueue(token).filter((q) => !(q.playerId === playerId && q.holeNumber === holeNumber)),
  );
}

/**
 * Sends queued scores in order. Stops at the first network failure (still
 * offline); a score the server rejects (e.g. event completed) is dropped and
 * reported so it can't block the rest forever.
 */
export async function flushQueue(token: string): Promise<{ sent: number; rejected: string[]; left: number }> {
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
    if (res.ok) {
      sent += 1;
    } else {
      const data = await res.json().catch(() => ({}));
      rejected.push(`Hole ${item.holeNumber}: ${data.error ?? "rejected"}`);
    }
    dropFromQueue(token, item.playerId, item.holeNumber);
  }
  return { sent, rejected, left: readQueue(token).length };
}
