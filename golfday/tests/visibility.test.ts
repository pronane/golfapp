/**
 * `events.is_public = 0` must actually mean something. The live board, its SSE
 * stream and the /live page are all shareable by design, so the rule lives in
 * one place (`canViewEventBoard`) and these tests pin it down.
 */
import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as null | { id: string; playerId: string | null; isSiteAdmin: boolean } }));
const access = vi.hoisted(() => ({ admins: new Set<string>() }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => session.user,
}));

vi.mock("@/lib/http", () => ({
  getEventAccess: async (eventId: string, user: { id: string } | null) =>
    user && access.admins.has(`${eventId}:${user.id}`) ? { role: "OWNER", isAdmin: true } : null,
}));

const entries = vi.hoisted(() => ({ registered: new Set<string>(), tokens: new Map<string, string>() }));

vi.mock("@/lib/events", () => ({
  getEventBundle: async () => null,
  getRevision: async () => 0,
  isRegisteredPlayer: async (eventId: string, playerId: string) => entries.registered.has(`${eventId}:${playerId}`),
  groupTokenEventId: async (token: string) => entries.tokens.get(token) ?? null,
}));

const { canViewEventBoard } = await import("@/lib/leaderboard");

const publicEvent = { id: "evt-public", isPublic: true };
const privateEvent = { id: "evt-private", isPublic: false };

describe("who can watch a live board", () => {
  it("lets anybody watch a public golf day, signed in or not", async () => {
    session.user = null;
    expect(await canViewEventBoard(publicEvent)).toBe(true);
    session.user = { id: "u1", playerId: "p1", isSiteAdmin: false };
    expect(await canViewEventBoard(publicEvent)).toBe(true);
  });

  it("hides a private golf day from anonymous visitors and ordinary players", async () => {
    session.user = null;
    expect(await canViewEventBoard(privateEvent)).toBe(false);

    session.user = { id: "player", playerId: "p2", isSiteAdmin: false };
    expect(await canViewEventBoard(privateEvent)).toBe(false);
  });

  it("shows a private golf day to the people who run it", async () => {
    session.user = { id: "organiser", playerId: "p3", isSiteAdmin: false };
    access.admins.add("evt-private:organiser");
    expect(await canViewEventBoard(privateEvent)).toBe(true);

    // ...and not to an organiser of a different event
    session.user = { id: "other-organiser", playerId: "p4", isSiteAdmin: false };
    expect(await canViewEventBoard(privateEvent)).toBe(false);
  });

  it("lets players entered in a private golf day watch their own board", async () => {
    session.user = { id: "entrant", playerId: "p9", isSiteAdmin: false };
    expect(await canViewEventBoard(privateEvent)).toBe(false);
    entries.registered.add("evt-private:p9");
    expect(await canViewEventBoard(privateEvent)).toBe(true);
  });

  it("lets a group scoring link follow its own private board, and no other", async () => {
    session.user = null;
    entries.tokens.set("tok-private", "evt-private");
    entries.tokens.set("tok-elsewhere", "evt-other");
    expect(await canViewEventBoard(privateEvent, "tok-private")).toBe(true);
    expect(await canViewEventBoard(privateEvent, "tok-elsewhere")).toBe(false);
    expect(await canViewEventBoard(privateEvent, "made-up")).toBe(false);
  });
});
