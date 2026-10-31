"use client";

import { useEffect, useRef, useState } from "react";
import type { LeaderboardPayload } from "@/lib/leaderboard";

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Subscribes to the event's Server-Sent Events stream.
 * `changed` holds player ids whose score moved on the most recent update, so the
 * UI can flash the row that just changed.
 */
export function useLiveBoard(
  eventId: string,
  initial: LeaderboardPayload | null,
  lite = false,
  /** group scoring token: lets a private event's scorecard follow its board */
  token?: string,
) {
  const [board, setBoard] = useState<LeaderboardPayload | null>(initial);
  const [status, setStatus] = useState<LiveStatus>(initial ? "live" : "connecting");
  const [changed, setChanged] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(initial ? new Date() : null);
  const previous = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    if (initial) {
      previous.current = new Map(initial.standings.map((s) => [s.playerId, s.points]));
    }
  }, [initial]);

  useEffect(() => {
    if (!eventId) return;
    const params = new URLSearchParams();
    if (lite) params.set("lite", "1");
    if (token) params.set("token", token);
    const query = params.toString();
    const source = new EventSource(`/api/events/${eventId}/stream${query ? `?${query}` : ""}`);

    source.addEventListener("open", () => setStatus("live"));

    source.addEventListener("leaderboard", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as LeaderboardPayload;
        const prior = previous.current;
        if (prior) {
          const moved = payload.standings
            .filter((s) => prior.get(s.playerId) !== s.points || prior.get(s.playerId) === undefined)
            .map((s) => s.playerId);
          if (moved.length > 0) {
            setChanged(moved);
            window.setTimeout(() => setChanged([]), 2200);
          }
        }
        previous.current = new Map(payload.standings.map((s) => [s.playerId, s.points]));
        setBoard(payload);
        setStatus("live");
        setLastUpdate(new Date());
      } catch (err) {
        console.warn("[live] bad payload", err);
      }
    });

    source.onerror = () => setStatus("offline");
    return () => source.close();
  }, [eventId, lite, token]);

  return { board, status, changed, lastUpdate };
}
