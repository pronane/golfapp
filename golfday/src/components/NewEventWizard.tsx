"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BLANK_CARD, CourseCardEditor, type CardHole } from "./CourseCardEditor";

type SavedCourse = {
  id: string;
  name: string;
  club: string | null;
  city: string | null;
  parTotal: number;
  holesCount: number;
  source: string;
};

type ProviderCourse = {
  externalId: string;
  name: string;
  club: string;
  city?: string;
  par: number;
  holes: { holeNumber: number; par: number; strokeIndex: number }[];
  source: string;
};

type Mode = "search" | "manual" | "later";

const todayPlus = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export function NewEventWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    date: todayPlus(14),
    startTime: "08:30",
    format: "STABLEFORD" as "STABLEFORD" | "STROKE_PLAY",
    handicapAllowance: 95,
    maxPlayers: 48,
    isPublic: true,
    status: "OPEN" as "DRAFT" | "OPEN",
  });

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<SavedCourse[]>([]);
  const [provider, setProvider] = useState<ProviderCourse[]>([]);
  const [searching, setSearching] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedHoles, setSelectedHoles] = useState<CardHole[] | null>(null);

  const [manual, setManual] = useState({
    name: "",
    club: "",
    address: "",
    teeName: "White",
    slope: 125,
    rating: 71.5,
    par: 72,
  });
  const [manualCard, setManualCard] = useState<CardHole[]>(BLANK_CARD);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (mode !== "search") return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const [savedRes, providerRes] = await Promise.all([
        fetch(`/api/courses?q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => ({ courses: [] })),
        fetch(`/api/courses/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => ({ courses: [] })),
      ]);
      if (cancelled) return;
      setSaved(savedRes.courses ?? []);
      setProvider(providerRes.courses ?? []);
      setProviderConfigured(Boolean(providerRes.configured));
      setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, mode]);

  async function chooseSaved(course: SavedCourse) {
    setSelectedId(course.id);
    setSelectedLabel(`${course.name}${course.club ? `, ${course.club}` : ""}`);
    const res = await fetch(`/api/courses/${course.id}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setSelectedHoles(data.holes ?? null);
    }
  }

  async function chooseProvider(course: ProviderCourse) {
    setBusy(true);
    setError(null);
    if (course.source === "CATALOGUE") {
      // catalogue courses are already in the library after seeding; import if not
      const match = saved.find((s) => s.name === course.name && (s.club ?? "") === course.club);
      if (match) {
        setSelectedId(match.id);
        setSelectedLabel(`${match.name}, ${match.club}`);
        setBusy(false);
        return;
      }
    }
    const res = await fetch("/api/courses/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalId: course.externalId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not import that course"); return; }
    setSelectedId(data.courseId);
    setSelectedLabel(`${course.name}${course.club ? `, ${course.club}` : ""}`);
    setSelectedHoles(course.holes);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let courseId = selectedId;
      if (mode === "manual") {
        if (!manual.name.trim()) throw new Error("Give the course a name");
        const courseRes = await fetch("/api/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: manual.name,
            club: manual.club,
            address: manual.address,
            country: "England",
            tees: [{ name: manual.teeName, colour: manual.teeName.toLowerCase(), slope: manual.slope, rating: manual.rating, par: manual.par }],
            holes: manualCard,
            source: "MANUAL",
          }),
        });
        const courseData = await courseRes.json();
        if (!courseRes.ok) throw new Error(courseData.error ?? "Could not save the course");
        courseId = courseData.courseId;
      }

      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          date: form.date,
          startTime: form.startTime,
          courseId: courseId ?? null,
          format: form.format,
          handicapAllowance: Number(form.handicapAllowance),
          maxPlayers: Number(form.maxPlayers),
          isPublic: form.isPublic,
          status: form.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the event");
      router.push(`/admin/events/${data.event.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const step1Valid = form.name.trim().length > 2;
  const canCreate = step1Valid && (mode !== "search" || Boolean(selectedId));

  const preview = useMemo(() => {
    if (mode === "manual") return manualCard;
    return selectedHoles;
  }, [mode, manualCard, selectedHoles]);

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-3 text-[12.5px] font-semibold">
        {[{ n: 1, label: "The golf day" }, { n: 2, label: "The course" }, { n: 3, label: "Review" }].map((s) => (
          <li key={s.n} className="flex items-center gap-2">
            <span className={`grid h-6 w-6 place-items-center rounded-full ${step >= s.n ? "bg-fairway-700 text-white" : "bg-ink/[0.07] text-ink/40"}`}>{s.n}</span>
            <span className={step >= s.n ? "text-ink" : "text-ink/40"}>{s.label}</span>
            {s.n < 3 && <span className="mx-1 h-px w-8 bg-ink/10" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="card card-pad space-y-4">
          <div>
            <label className="label" htmlFor="name">Event name</label>
            <input id="name" className="input" value={form.name} placeholder="Autumn Invitational" onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="desc">Description <span className="font-normal text-ink/35">(optional)</span></label>
            <textarea id="desc" rows={2} className="input" value={form.description} placeholder="Three-ball better-ball, shotgun start, best two scores count." onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="date">Date</label>
              <input id="date" type="date" className="input" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="time">First tee</label>
              <input id="time" type="time" className="input" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="max">Max players</label>
              <input id="max" type="number" min={1} max={200} className="input" value={form.maxPlayers} onChange={(e) => set("maxPlayers", Number(e.target.value))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="format">Format</label>
              <select id="format" className="select" value={form.format} onChange={(e) => set("format", e.target.value as typeof form.format)}>
                <option value="STABLEFORD">Stableford (points)</option>
                <option value="STROKE_PLAY">Stroke play (net)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="allowance">Handicap allowance ({form.handicapAllowance}%)</label>
              <input id="allowance" type="range" min={0} max={100} step={5} value={form.handicapAllowance} onChange={(e) => set("handicapAllowance", Number(e.target.value))} className="mt-3 w-full accent-fairway-700" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-ink/[0.03] p-3">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" className="h-4 w-4 rounded accent-fairway-700" checked={form.isPublic} onChange={(e) => set("isPublic", e.target.checked)} />
              Public event (listed and watchable)
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" className="h-4 w-4 rounded accent-fairway-700" checked={form.status === "OPEN"} onChange={(e) => set("status", e.target.checked ? "OPEN" : "DRAFT")} />
              Open for entries straight away
            </label>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>Next: choose the course</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card card-pad space-y-4">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "search" as Mode, label: "Search courses" },
              { id: "manual" as Mode, label: "Type a new course" },
              { id: "later" as Mode, label: "Decide later" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`rounded-xl px-3 py-2 text-[13px] font-semibold transition ${mode === tab.id ? "bg-fairway-700 text-white" : "bg-ink/[0.04] text-ink/60 hover:bg-ink/[0.07]"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === "search" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by course, club or town - e.g. Sunningdale, Wentworth, Newport" />
                <span className="grid shrink-0 place-items-center rounded-xl bg-ink/[0.04] px-3 text-[12px] text-ink/50">
                  {searching ? "…" : `${saved.length + provider.length}`}
                </span>
              </div>
              <p className="text-[11.5px] text-ink/45">
                {providerConfigured
                  ? "Live results from GolfCourseAPI (free key configured) plus your saved library."
                  : "Showing your saved library and the bundled catalogue. Add a free GOLF_COURSE_API_KEY to search the full GolfCourseAPI database."}
              </p>
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {saved.map((course) => (
                  <button
                    key={course.id}
                    onClick={() => chooseSaved(course)}
                    className={`rounded-xl p-3 text-left ring-1 ring-inset transition ${selectedId === course.id ? "bg-fairway-50 ring-fairway-300" : "bg-white ring-ink/10 hover:bg-ink/[0.03]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold">{course.name}</span>
                      <span className="pill bg-ink/[0.05] text-ink/50 ring-ink/10">library</span>
                    </div>
                    <div className="text-[11.5px] text-ink/50">{course.club}{course.city ? ` · ${course.city}` : ""} · par {course.parTotal} · {course.holesCount} holes</div>
                  </button>
                ))}
                {provider
                  .filter((course) => !saved.some((s) => s.name === course.name && (s.club ?? "") === course.club))
                  .map((course) => (
                    <button
                      key={`${course.source}-${course.externalId}`}
                      onClick={() => chooseProvider(course)}
                      className="rounded-xl bg-white p-3 text-left ring-1 ring-inset ring-ink/10 transition hover:bg-ink/[0.03]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold">{course.name}</span>
                        <span className="pill bg-sand-50 text-sand-700 ring-sand-200">{course.source === "CATALOGUE" ? "catalogue" : "provider"}</span>
                      </div>
                      <div className="text-[11.5px] text-ink/50">{course.club}{course.city ? ` · ${course.city}` : ""} · par {course.par} · {course.holes.length} holes</div>
                    </button>
                  ))}
                {!searching && saved.length === 0 && provider.length === 0 && (
                  <p className="col-span-2 py-4 text-center text-[13px] text-ink/45">No courses match. Try “Type a new course”.</p>
                )}
              </div>
              {selectedId && (
                <div className="rounded-xl bg-fairway-50 p-3 ring-1 ring-inset ring-fairway-200">
                  <p className="text-[13px] font-semibold text-fairway-900">Selected: {selectedLabel}</p>
                  <p className="text-[12px] text-fairway-800/70">The full 18-hole card will be snapshotted onto the event - you can still tweak par and stroke index afterwards.</p>
                </div>
              )}
            </div>
          )}

          {mode === "manual" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="cname">Course name</label>
                  <input id="cname" className="input" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="The Championship Course" />
                </div>
                <div>
                  <label className="label" htmlFor="cclub">Club</label>
                  <input id="cclub" className="input" value={manual.club} onChange={(e) => setManual({ ...manual, club: e.target.value })} placeholder="Harrow Golf Club" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="caddr">Address <span className="font-normal text-ink/35">(optional)</span></label>
                  <input id="caddr" className="input" value={manual.address} onChange={(e) => setManual({ ...manual, address: e.target.value })} placeholder="Oxhey Lane, Harrow" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="label" htmlFor="tee">Tee</label>
                  <input id="tee" className="input" value={manual.teeName} onChange={(e) => setManual({ ...manual, teeName: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="slope">Slope</label>
                  <input id="slope" type="number" className="input" value={manual.slope} onChange={(e) => setManual({ ...manual, slope: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label" htmlFor="rating">Rating</label>
                  <input id="rating" type="number" step="0.1" className="input" value={manual.rating} onChange={(e) => setManual({ ...manual, rating: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label" htmlFor="cpar">Par</label>
                  <input id="cpar" type="number" className="input" value={manual.par} onChange={(e) => setManual({ ...manual, par: Number(e.target.value) })} />
                </div>
              </div>
              <CourseCardEditor holes={manualCard} onChange={setManualCard} />
            </div>
          )}

          {mode === "later" && (
            <div className="rounded-xl bg-sand-50 p-4 text-[13px] leading-relaxed text-sand-700 ring-1 ring-inset ring-sand-200">
              No problem - create the event now with a placeholder card and pick the course from the organiser console when you know it.
              Par and stroke index default to a standard 72.
            </div>
          )}

          {preview && mode === "search" && (
            <div className="overflow-x-auto rounded-xl bg-ink/[0.02] p-3">
              <div className="grid grid-cols-9 gap-1 text-center text-[11px]">
                {preview.map((hole) => (
                  <div key={hole.holeNumber} className="rounded-md bg-white px-0.5 py-1 ring-1 ring-inset ring-ink/[0.06]">
                    <div className="text-[9.5px] text-ink/40">{hole.holeNumber}</div>
                    <div className="font-mono font-semibold">{hole.par}</div>
                    <div className="font-mono text-[9.5px] text-ink/40">{hole.strokeIndex}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10.5px] text-ink/40">Top: hole · middle: par · bottom: stroke index</p>
            </div>
          )}

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn-primary" disabled={!canCreate} onClick={() => setStep(3)}>Next: review</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card card-pad space-y-4">
          <h2 className="text-lg font-bold">Ready to create</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Event" value={form.name} />
            <Row label="When" value={`${form.date} · first tee ${form.startTime}`} />
            <Row label="Course" value={mode === "later" ? "To be confirmed" : mode === "manual" ? `${manual.name}${manual.club ? `, ${manual.club}` : ""}` : selectedLabel ?? "—"} />
            <Row label="Format" value={`${form.format === "STABLEFORD" ? "Stableford" : "Net stroke play"} · ${form.handicapAllowance}% allowance`} />
            <Row label="Field" value={`up to ${form.maxPlayers} players`} />
            <Row label="Visibility" value={form.isPublic ? "Public" : "Private"} />
          </dl>
          <div className="rounded-xl bg-fairway-50 p-3 text-[12.5px] text-fairway-900 ring-1 ring-inset ring-fairway-200">
            After creating you get the join code, the leaderboard URL and a private scorecard link per group.
          </div>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(2)} disabled={busy}>Back</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create golf day"}</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink/[0.03] px-3 py-2">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className="text-[13.5px] font-semibold">{value}</dd>
    </div>
  );
}
