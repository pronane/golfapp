"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatEventDate } from "@/lib/format";

type Season = {
  id: string;
  slug: string;
  name: string;
  startsOn: string;
  endsOn: string;
  scheme: string;
  bestOf: number;
  societyId: string | null;
};

/** Organiser view of seasons: everything on the site, plus a quick create form. */
export function SeasonsAdmin({ seasons }: { seasons: Season[] }) {
  const router = useRouter();
  const year = new Date().getFullYear();
  const [form, setForm] = useState({
    name: `${year} Order of Merit`,
    startsOn: `${year}-01-01`,
    endsOn: `${year}-12-31`,
    scheme: "POSITION",
    bestOf: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/seasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, bestOf: Number(form.bestOf) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Couldn't create that season");
    else router.push(`/seasons/${data.season.slug}`);
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
          <h2 className="text-[15px] font-bold">All seasons</h2>
          <span className="text-[12px] text-ink/45">{seasons.length}</span>
        </div>
        <ul className="divide-y divide-ink/[0.06]">
          {seasons.map((season) => (
            <li key={season.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/seasons/${season.slug}`} className="truncate text-[14px] font-semibold hover:text-fairway-800">
                  {season.name}
                </Link>
                <div className="text-[11.5px] text-ink/45">
                  {formatEventDate(season.startsOn)} – {formatEventDate(season.endsOn)} ·{" "}
                  {season.scheme === "STABLEFORD" ? "Stableford points" : "Order of merit points"}
                  {season.bestOf > 0 ? ` · best ${season.bestOf} count` : ""}
                  {season.societyId ? " · society season" : " · standalone"}
                </div>
              </div>
              <Link href={`/seasons/${season.slug}`} className="text-[12px] font-semibold text-fairway-700 hover:underline">
                Table
              </Link>
            </li>
          ))}
          {seasons.length === 0 && <li className="px-5 py-8 text-center text-[13px] text-ink/50">No seasons yet.</li>}
        </ul>
      </section>

      <form onSubmit={create} className="card card-pad space-y-3">
        <div>
          <h2 className="text-[15px] font-bold">Start a season</h2>
          <p className="text-[12.5px] text-ink/55">Add golf days to it afterwards from the season page.</p>
        </div>
        <div>
          <label className="label" htmlFor="admin-season-name">Name</label>
          <input id="admin-season-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="admin-season-start">Starts</label>
            <input id="admin-season-start" type="date" className="input" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="admin-season-end">Ends</label>
            <input id="admin-season-end" type="date" className="input" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="admin-season-scheme">Scoring</label>
            <select id="admin-season-scheme" className="select" value={form.scheme} onChange={(e) => setForm({ ...form, scheme: e.target.value })}>
              <option value="POSITION">Positions (100-90-80…)</option>
              <option value="STABLEFORD">Stableford points</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="admin-season-best">Best N (0 = all)</label>
            <input id="admin-season-best" type="number" min={0} max={40} className="input" value={form.bestOf} onChange={(e) => setForm({ ...form, bestOf: Number(e.target.value) })} />
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create season"}</button>
      </form>
    </div>
  );
}
