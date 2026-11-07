import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, flushQueue, readQueue } from "@/components/offlineQueue";

const score = (round: number, strokes = 4) => ({
  eventId: "event-1",
  playerId: "player-1",
  holeNumber: 1,
  strokes,
  token: "offline-queue-test",
  round,
});

describe("offline score queue", () => {
  let values: Map<string, string>;
  let token: string;

  beforeEach(() => {
    values = new Map();
    token = `offline-queue-${crypto.randomUUID()}`;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the same hole from separate rounds as distinct scores", () => {
    enqueue({ ...score(1), token });
    enqueue({ ...score(2, 5), token });

    expect(readQueue(token)).toEqual([{ ...score(1), token }, { ...score(2, 5), token }]);
  });

  it("removes a synced score from its own round only", async () => {
    enqueue({ ...score(1), token });
    enqueue({ ...score(2, 5), token });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    const result = await flushQueue(token);

    expect(result).toEqual({ sent: 2, rejected: [], left: 0 });
    expect(readQueue(token)).toEqual([]);
  });

  it("keeps scores queued after a temporary server failure", async () => {
    enqueue({ ...score(1), token });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));

    const result = await flushQueue(token);

    expect(result).toEqual({ sent: 0, rejected: [], left: 1 });
    expect(readQueue(token)).toEqual([{ ...score(1), token }]);
  });

  it("keeps a score in memory and reports that it is not durable when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("storage blocked"); },
        setItem: () => { throw new Error("storage blocked"); },
        removeItem: () => { throw new Error("storage blocked"); },
      },
    });

    expect(enqueue({ ...score(1), token })).toBe(false);
    expect(readQueue(token)).toEqual([{ ...score(1), token }]);
  });
});
