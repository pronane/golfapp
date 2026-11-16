import { describe, expect, it } from "vitest";
import { parseCourseCsv, parseEventCsv } from "@/lib/csvImports";
import { parsePlayerCsv } from "@/lib/golfengland";

describe("competitor CSV header variants", () => {
  it("maps common player export columns to the GolfDay player shape", () => {
    const parsed = parsePlayerCsv("Player,HI,Club,CDH Number,Email Address\nJane Smith,12.3,Harrow GC,CDH123,jane@example.com");
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows[0]).toMatchObject({
      name: "Jane Smith",
      handicapIndex: 12.3,
      homeClub: "Harrow GC",
      golfEnglandId: "CDH123",
      email: "jane@example.com",
    });
  });
});

describe("course CSV imports", () => {
  it("reads a complete course card with tee data", () => {
    const csv = [
      "Course Name,Club,Tee,Slope,Rating,Hole,Par,Stroke Index",
      ...Array.from({ length: 18 }, (_, index) =>
        `Park Course,Park Club,Yellow,122,71.4,${index + 1},${index < 12 ? 4 : 3},${index + 1}`,
      ),
    ].join("\n");
    const parsed = parseCourseCsv(csv);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]).toMatchObject({
      name: "Park Course",
      club: "Park Club",
      teeName: "Yellow",
      slope: 122,
      rating: 71.4,
    });
    expect(parsed.courses[0].holes).toHaveLength(18);
  });

  it("rejects incomplete or duplicate hole cards", () => {
    const parsed = parseCourseCsv(
      "Course,Hole,Par,SI\nPark Course,1,4,1\nPark Course,1,4,1",
    );
    expect(parsed.courses).toHaveLength(0);
    expect(parsed.errors.some((error) => error.includes("duplicate hole"))).toBe(true);
  });
});

describe("event CSV imports", () => {
  it("normalizes common formats and UK dates", () => {
    const parsed = parseEventCsv(
      "Competition,Date,Tee Time,Course,Event Format,Allowance,Field Size\n" +
        "Summer Medal,15/06/2027,08:30,Park Course,Medal,95%,72\n" +
        "Society Day,2027-06-16,09:00,Park Course,Texas Scramble,100,36",
    );
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.events).toEqual([
      expect.objectContaining({ name: "Summer Medal", date: "2027-06-15", format: "STROKE_PLAY", handicapAllowance: 95 }),
      expect.objectContaining({ name: "Society Day", date: "2027-06-16", format: "TEXAS_SCRAMBLE", maxPlayers: 36 }),
    ]);
  });

  it("reports invalid event rows", () => {
    const parsed = parseEventCsv("Event Name,Date,Format\nBad Event,31/02/2027,Unknown");
    expect(parsed.events).toHaveLength(0);
    expect(parsed.errors[0]).toContain("invalid name, date, format");
  });
});
