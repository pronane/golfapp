"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BLANK_CARD, CourseCardEditor, type CardHole } from "./CourseCardEditor";

type CourseRow = {
  id: string;
  name: string;
  club: string | null;
  city: string | null;
  parTotal: number;
  holesCount: number;
  source: string;
};

export function AdminCourses({ courses }: { courses: CourseRow[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [providerResults, setProviderResults] = useState<
    { externalId: string; name: string; club: string; city?: string; par: number; holes: unknown[]; source: string }[]
  >([]);
  const [searching, setSearching] = useState(false);

  const [form, setForm] = useState({
    name: "",
    club: "",
    city: "",
    address: "",
    teeName: "White",
    slope: 125,
    rating: 71.5,
  });
  const [holes, setHoles] = useState<CardHole[]>(BLANK_CARD);

  async function searchProvider() {
    setSearching(true);
    const res = await fetch(`/api/courses/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setProviderResults(data.courses ?? []);
    setSearching(false);
  }

  async function importCourse(externalId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/courses/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Import failed"); return; }
    setMessage("Course imported into your library");
    router.refresh();
  }

  async function createCourse() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        club: form.club,
        city: form.city,
        address: form.address,
        tees: [{ name: form.teeName, colour: form.teeName.toLowerCase(), slope: form.slope, rating: form.rating, par: holes.reduce((s, h) => s + h.par, 0) }],
        holes,
        source: "MANUAL",
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not save the course"); return; }
    setMessage("Course added to your library");
    setShowForm(false);
    setHoles(BLANK_CARD);
    setForm({ ...form, name: "", club: "", city: "", address: "" });
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Course library</h1>
          <p className="mt-1 text-[14px] text-ink/55">Everything an event can be played on. Import from the provider or build a card by hand.</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Close builder" : "New course"}</button>
      </div>

      {(message || error) && (
        <div className={`rounded-xl px-4 py-2.5 text-[13px] font-medium ${error ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"}`}>
          {error ?? message}
        </div>
      )}

      {showForm && (
        <section className="card card-pad space-y-4">
          <h2 className="text-[15px] font-bold">New course</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="n">Course name</label>
              <input id="n" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="The Championship Course" />
            </div>
            <div>
              <label className="label" htmlFor="c">Club</label>
              <input id="c" className="input" value={form.club} onChange={(e) => setForm({ ...form, club: e.target.value })} placeholder="Harrow Golf Club" />
            </div>
            <div>
              <label className="label" htmlFor="city">Town / city</label>
              <input id="city" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Harrow" />
            </div>
            <div>
              <label className="label" htmlFor="a">Address</label>
              <input id="a" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Oxhey Lane" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="t">Tee</label>
              <input id="t" className="input" value={form.teeName} onChange={(e) => setForm({ ...form, teeName: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="s">Slope</label>
              <input id="s" type="number" className="input" value={form.slope} onChange={(e) => setForm({ ...form, slope: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label" htmlFor="r">Rating</label>
              <input id="r" type="number" step="0.1" className="input" value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} />
            </div>
          </div>
          <CourseCardEditor holes={holes} onChange={setHoles} disabled={busy} />
          <div className="flex justify-end">
            <button className="btn-primary btn-sm" disabled={busy || form.name.trim().length < 2} onClick={createCourse}>Save course</button>
          </div>
        </section>
      )}

      <section className="card card-pad">
        <h2 className="text-[15px] font-bold">Import from GolfCourseAPI</h2>
        <p className="mt-1 text-[12.5px] text-ink/55">
          Free key from golfcourseapi.com - set GOLF_COURSE_API_KEY and searches hit the live database. Without a key you can still import from the bundled catalogue.
        </p>
        <div className="mt-2 flex gap-2">
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchProvider()} placeholder="Sunningdale, Wentworth, St Andrews…" />
          <button className="btn-secondary btn-sm shrink-0" onClick={searchProvider} disabled={searching}>{searching ? "…" : "Search"}</button>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {providerResults.map((course) => (
            <li key={`${course.source}-${course.externalId}`} className="flex items-center gap-2 rounded-xl bg-ink/[0.03] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{course.name}</div>
                <div className="truncate text-[11.5px] text-ink/45">{course.club} · par {course.par} · {course.holes.length} holes</div>
              </div>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => importCourse(course.externalId)}>Import</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-ink/[0.06] px-5 py-3">
          <h2 className="text-[15px] font-bold">Library ({courses.length})</h2>
        </div>
        <table className="table-base">
          <thead>
            <tr><th>Course</th><th>Location</th><th className="text-center">Par</th><th className="text-center">Holes</th><th>Source</th></tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id}>
                <td className="font-semibold">{course.name}<div className="text-[11.5px] font-normal text-ink/45">{course.club}</div></td>
                <td className="text-[12.5px] text-ink/60">{course.city ?? "—"}</td>
                <td className="text-center font-mono text-[12.5px]">{course.parTotal}</td>
                <td className="text-center font-mono text-[12.5px]">{course.holesCount}</td>
                <td><span className="pill bg-ink/[0.04] text-ink/55 ring-ink/10">{course.source.toLowerCase()}</span></td>
              </tr>
            ))}
            {courses.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-[13px] text-ink/45">No courses yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
