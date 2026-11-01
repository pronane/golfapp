/**
 * Cash on the day.
 *
 * Most golf days - and every day a group of friends puts together - are settled
 * in cash or by transfer, not by card. So `CASH` is the default, a cash event
 * never shows a card button, and asking for a checkout on one is refused rather
 * than quietly opening a Stripe form.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-paymode-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.AUTH_SECRET = "test-secret-for-payment-mode-tests-0123456789";

let games: typeof import("@/lib/games");
let auth: typeof import("@/lib/auth");
let events: typeof import("@/lib/events");
let push: typeof import("@/db/push");

const card = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

beforeAll(async () => {
  [games, auth, events, push] = await Promise.all([
    import("@/lib/games"),
    import("@/lib/auth"),
    import("@/lib/events"),
    import("@/db/push"),
  ]);
  await push.pushSchema();
}, 60_000);

describe("how an entry fee is collected", () => {
  it("defaults to cash, so a new day never asks anyone for a card", () => {
    expect(games.DEFAULT_SETTINGS.paymentMode).toBe("CASH");
    expect(games.cleanSettings({}).paymentMode).toBe("CASH");
    // Anything unrecognised falls back to cash rather than to card.
    expect(games.cleanSettings({ paymentMode: "paypal" }).paymentMode).toBe("CASH");
    expect(games.cleanSettings({ paymentMode: "STRIPE" }).paymentMode).toBe("STRIPE");
  });

  it("keeps a fee with cash, and keeps cash when the fee is cleared", () => {
    const cash = games.cleanSettings({ entryFeePence: 2500, paymentMode: "CASH" });
    expect(cash).toMatchObject({ entryFeePence: 2500, paymentMode: "CASH" });
    const free = games.cleanSettings({ entryFeePence: 0, paymentMode: "CASH" });
    expect(free.entryFeePence).toBe(0);
  });

  it("round-trips the mode through the database with the rest of the settings", async () => {
    const { userId } = await auth.createUserWithPlayer({
      name: "Cash Organiser",
      email: `cash-${Date.now()}@example.com`,
      password: "golfday123",
    });
    const event = await events.createEvent({
      name: "Friendly Fourball",
      date: "2026-11-20",
      startTime: "09:00",
      courseId: null,
      format: "STABLEFORD",
      handicapAllowance: 95,
      maxPlayers: 8,
      status: "OPEN",
      isPublic: true,
      holes: card,
      importExternalId: null,
      societyId: null,
      createdBy: userId,
    });

    // A brand-new event reads as cash, free entry: nothing to pay online.
    expect(await games.getGameSettings(event.id)).toMatchObject({ paymentMode: "CASH", entryFeePence: 0 });

    await games.saveGameSettings(event.id, { ...games.DEFAULT_SETTINGS, entryFeePence: 2000, paymentMode: "CASH" });
    expect(await games.getGameSettings(event.id)).toMatchObject({ entryFeePence: 2000, paymentMode: "CASH" });

    // Switching to card is explicit, and survives the round trip.
    await games.saveGameSettings(event.id, { ...games.DEFAULT_SETTINGS, entryFeePence: 2000, paymentMode: "STRIPE" });
    expect(await games.getGameSettings(event.id)).toMatchObject({ entryFeePence: 2000, paymentMode: "STRIPE" });
  }, 60_000);
});
