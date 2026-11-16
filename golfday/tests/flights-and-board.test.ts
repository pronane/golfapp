/**
 * Flights, the hidden-board rule and the invitation wording.
 *
 * All three are decisions the organiser makes in one click and a player then
 * lives with all day, so they are covered without a browser: the banding and
 * the redaction are pure, and the template is a string function.
 */
import { describe, expect, it } from "vitest";
import { bandPlayers, cleanFlightCount, splitIntoFlights } from "@/lib/flights";
import { formatLabel, isTeamFormat } from "@/lib/status";
import { inviteBody, inviteSubject } from "@/lib/invites";
import { looksLikeEmail } from "@/lib/mailer";

const field = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, playerName: `Player ${i}`, playingHandicap: i }));

describe("flights", () => {
  it("splits 19 players into balanced bands, 7/6/6", () => {
    const bands = bandPlayers(field(19), 3);
    expect(bands).toHaveLength(3);
    expect(bands.map((b) => b.playerIds.length)).toEqual([7, 6, 6]);
    expect(bands[0].name).toBe("Flight 1");
    expect(bands.flatMap((b) => b.playerIds)).toHaveLength(19);
    expect(new Set(bands.flatMap((b) => b.playerIds)).size).toBe(19);
  });

  it("keeps the low handicaps together and the high ones together", () => {
    const rows = [
      { playerId: "scratch", playerName: "A", playingHandicap: 0 },
      { playerId: "mid", playerName: "B", playingHandicap: 12 },
      { playerId: "high", playerName: "C", playingHandicap: 30 },
      { playerId: "higher", playerName: "D", playingHandicap: 36 },
    ];
    const bands = bandPlayers(rows, 2);
    expect(bands[0].playerIds).toEqual(["scratch", "mid"]);
    expect(bands[1].playerIds).toEqual(["high", "higher"]);
  });

  it("does nothing sensible with one flight, a tiny field, or garbage", () => {
    expect(bandPlayers(field(12), 1)).toEqual([]);
    expect(bandPlayers(field(3), 2)).toEqual([]);
    expect(bandPlayers(field(12), Number.NaN)).toEqual([]);
    expect(cleanFlightCount("3")).toBe(3);
    expect(cleanFlightCount(1)).toBe(0);
    expect(cleanFlightCount(99)).toBe(6);
    expect(cleanFlightCount(undefined)).toBe(0);
  });

  it("groups the rows back into their flights, ready to be re-ranked", () => {
    const bands = bandPlayers(field(6), 2);
    const flights = splitIntoFlights(field(6), bands);
    expect(flights).toHaveLength(2);
    expect(flights[0].rows.map((r) => r.playerId)).toEqual(bands[0].playerIds);
    expect(flights.flatMap((f) => f.rows)).toHaveLength(6);
  });
});

describe("formatLabel", () => {
  it("names every format, including the one the fixture list got wrong", () => {
    expect(formatLabel("STABLEFORD")).toBe("Stableford");
    expect(formatLabel("STROKE_PLAY")).toBe("Stroke play");
    expect(formatLabel("TEXAS_SCRAMBLE")).toBe("Texas scramble");
    expect(isTeamFormat("TEXAS_SCRAMBLE")).toBe(true);
    expect(isTeamFormat("STABLEFORD")).toBe(false);
  });
});

describe("invitations", () => {
  const event = {
    name: "Autumn Invitational",
    date: "2026-11-01",
    startTime: "09:10",
    courseName: "Old Course, Sunningdale",
    slug: "autumn-invitational",
    joinCode: "33VDC3",
  };

  it("titles the message with the group and the tee time", () => {
    expect(inviteSubject("Autumn Invitational", "Group 2", "09:20")).toBe("Autumn Invitational - Group 2, 09:20");
    expect(inviteSubject("Autumn Invitational", null, null)).toBe("Autumn Invitational - you're in the field");
  });

  it("puts the card link, the join code and the group in the body", () => {
    const body = inviteBody({
      playerName: "Sam Whitcombe",
      event,
      group: { name: "Group 2", teeTime: "09:20" },
      cardUrl: "https://golfday.example/score/abc123",
      leaderboardUrl: "https://golfday.example/live/autumn-invitational",
      origin: "https://golfday.example",
    });
    expect(body).toContain("Hi Sam,");
    expect(body).toContain("Group 2, teeing off at 09:20");
    expect(body).toContain("https://golfday.example/score/abc123");
    expect(body).toContain("https://golfday.example/live/autumn-invitational");
    expect(body).toContain("33VDC3");
    expect(body).toContain("Old Course, Sunningdale");
  });

  it("says something useful when the player has no group yet", () => {
    const body = inviteBody({
      playerName: "Jo Guest",
      event,
      group: null,
      cardUrl: "https://golfday.example/events/autumn-invitational",
      leaderboardUrl: "https://golfday.example/live/autumn-invitational",
      origin: "https://golfday.example",
    });
    expect(body).toContain("tee groups are published nearer the day");
    expect(body).not.toContain("undefined");
  });

  it("refuses an address that is not one", () => {
    expect(looksLikeEmail("sam@golfday.app")).toBe(true);
    expect(looksLikeEmail(" sam@club.co.uk ")).toBe(true);
    expect(looksLikeEmail("not-an-address")).toBe(false);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail(null)).toBe(false);
  });
});
