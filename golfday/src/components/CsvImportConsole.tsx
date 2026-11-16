"use client";

import Link from "next/link";
import { useState } from "react";

type ImportKind = "players" | "courses" | "events";
type Result = { message: string; warnings: string[]; events: { eventId: string; name: string; date: string }[] };

const courseRows = Array.from({ length: 18 }, (_, index) =>
  `Sample Course,Sample Club,White,113,72,${index + 1},${index < 12 ? 4 : index < 16 ? 3 : 5},${index + 1}`,
);

const TEMPLATES: Record<ImportKind, string> = {
  players: "Player,Handicap Index,Club,CDH Number,Email Address\nJane Smith,12.3,Harrow GC,CDH123,jane@example.com",
  courses: `Course Name,Club,Tee,Slope,Rating,Hole,Par,Stroke Index\n${courseRows.join("\n")}`,
  events: "Event Name,Date,Start Time,Course,Format,Handicap Allowance,Max Players\nMonthly Medal,2027-06-15,08:30,Sample Course,Stroke Play,95,72\nSummer Scramble,2027-06-16,09:00,Sample Course,Texas Scramble,95,72",
};

const ENDPOINTS: Record<ImportKind, string> = {
  players: "/api/players/import",
  courses: "/api/courses/import-csv",
  events: "/api/events/import",
};

const EXPLANATIONS: Record<ImportKind, string> = {
  players: "One player per row. Handicap Index, Player/Member, Club, email, and common CDH/GHIN ID headings are recognised.",
  courses: "One row per hole. Import one complete 18-hole card and one tee per course; par and stroke-index columns are required.",
  events: "One event per row. Dates may be YYYY-MM-DD or UK DD/MM/YYYY; event formats include Stableford, Stroke Play/Medal, and Texas Scramble.",
};

export function CsvImportConsole() {
  const [kind, setKind] = useState<ImportKind>("players");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function importCsv() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(ENDPOINTS[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Import failed");
      const warnings = Array.isArray(data.errors) ? data.errors.map(String) : [];
      const message = kind === "players"
        ? `${data.created} created, ${data.updated} updated`
        : kind === "courses"
          ? `${data.created} courses created, ${data.existing} already in the library`
          : `${data.imported.length} events imported as drafts`;
      setResult({ message, warnings, events: data.imported ?? [] });
      setCsv("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/admin" className="text-[12.5px] font-semibold text-ink/50 hover:text-ink/80">← Organiser</Link>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Import CSV</h1>
        <p className="mt-1 text-[14px] text-ink/55">
          Import CSV exports from Golf Genius, ClubV1, PlayThru or other club systems when their columns match the formats below. If needed, rename columns in a spreadsheet first; GolfDay does not log in to competitor websites or scrape private pages.
        </p>
      </div>

      {(error || result) && (
        <div className={`rounded-xl px-4 py-3 text-[13px] ${error ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"}`}>
          <p className="font-semibold">{error ?? result?.message}</p>
          {result?.events.map((event) => (
            <p key={event.eventId} className="mt-1">
              <Link className="underline" href={`/admin/events/${event.eventId}`}>{event.name}</Link> · {event.date}
            </p>
          ))}
          {result?.warnings.map((warning, index) => <p key={index} className="mt-1 text-[12px]">{warning}</p>)}
        </div>
      )}

      <section className="card card-pad space-y-3">
        <div>
          <label className="label" htmlFor="import-kind">What are you importing?</label>
          <select id="import-kind" className="select" value={kind} onChange={(event) => { setKind(event.target.value as ImportKind); setResult(null); }}>
            <option value="players">Players and handicaps</option>
            <option value="courses">Courses and scorecards</option>
            <option value="events">Events</option>
          </select>
        </div>
        <p className="text-[12.5px] text-ink/55">{EXPLANATIONS[kind]}</p>
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary btn-sm cursor-pointer">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) setCsv(await file.text());
                event.target.value = "";
              }}
            />
          </label>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setCsv(TEMPLATES[kind])}>Load example</button>
        </div>
        <textarea
          aria-label="CSV contents"
          className="input font-mono text-[11.5px]"
          rows={kind === "courses" ? 9 : 6}
          placeholder={TEMPLATES[kind]}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
        <div className="flex justify-end">
          <button type="button" className="btn-primary btn-sm" disabled={busy || csv.trim().length < 5} onClick={importCsv}>
            {busy ? "Importing…" : `Import ${kind}`}
          </button>
        </div>
      </section>
    </div>
  );
}
