/**
 * The outreach generator's honesty contract.
 *
 * These emails go to real clubs and societies. The rules that matter:
 * - we never claim we do things we don't (official CDH submission, tee booking);
 * - we always say we run alongside HowDidiDo / Golf Genius, not instead of them;
 * - every competitor price carries its source and a checked date;
 * - the two audiences get their own pitch, not one mail-merged blob.
 */
import { describe, expect, it } from "vitest";
import { renderEmail, renderExamples } from "../scripts/outreach.mjs";

const club = renderEmail({ type: "club", name: "Harrow Golf Club", contact: "Sue" });
const society = renderEmail({ type: "society", name: "the North London Golf Society", contact: "Dave" });

describe("rendering", () => {
  it("fills the name and contact into both audiences", () => {
    expect(club).toContain("Harrow Golf Club");
    expect(club).toContain("Hello Sue,");
    expect(society).toContain("North London Golf Society");
    expect(society).toContain("Hello Dave,");
  });

  it("refuses an unknown audience or a missing name", () => {
    expect(() => renderEmail({ type: "charity" as "club", name: "x" })).toThrow(/club.*society/);
    expect(() => renderEmail({ type: "club", name: " " })).toThrow(/name/);
  });

  it("has a subject line and a plain-text table that lines up", () => {
    expect(club.split("\n")[0]).toMatch(/^Subject: /);
    // The ASCII table has a dashed rule row with the same width as its header.
    const header = club.split("\n").find((l) => l.startsWith("What it does"));
    const rule = club.split("\n").find((l) => l.startsWith("---------"));
    expect(header && rule && rule.length).toBe(header?.length);
  });

  it("renders markdown when asked", () => {
    const md = renderEmail({ type: "club", name: "Harrow Golf Club", markdown: true });
    expect(md).toContain("| What it does | Golfday |");
    expect(md).toContain("**Golfday (us)**");
  });

  it("prints both canned examples on a bare run", () => {
    const examples = renderExamples();
    expect(examples).toContain("CLUB");
    expect(examples).toContain("SOCIETY");
  });
});

describe("honesty rules", () => {
  it("says we run alongside the club systems, not instead of them", () => {
    expect(club).toContain("not a proposal to move your members off HowDidiDo or Golf Genius");
    expect(society).toContain("don't price for");
  });

  it("never claims official handicap submission or tee-time booking", () => {
    for (const email of [club, society]) {
      expect(email).not.toMatch(/we submit.*CDH|CDH submission|official handicaps? (submission|write-back)/i);
      expect(email).not.toMatch(/book (your )?tee times with us/i);
      // The CDH row must state the limitation, not hide it.
      expect(email).toContain("Lookup only - never required");
    }
  });

  it("flags every competitor price with a source and a checked date", () => {
    for (const email of [club, society]) {
      expect(email).toContain("Prices checked");
      expect(email).toContain("secondary sources");
      expect(email).toContain("checked Oct 2026"); // HowDidiDo
      expect(email).toContain("checked Nov 2026"); // Golf Genius / GolfNow
    }
  });

  it("keeps players out of the payment story", () => {
    for (const email of [club, society]) {
      expect(email).toMatch(/players never forced online|never forced to pay online/);
      expect(email).toContain("Cash stays cash");
    }
  });

  it("gives each audience its own opener", () => {
    expect(club).toContain("captain's day");
    expect(society).toContain("fixtures");
    expect(society).not.toContain("captain's day");
  });
});
