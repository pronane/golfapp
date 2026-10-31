"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type SocietySummary = {
  id: string;
  slug: string;
  name: string;
  homeClub: string | null;
  role: string;
};

/**
 * "My societies" - the front door to the society tools: the clubs you belong
 * to, joining one with its code, and starting a new one.
 */
export function SocietiesHome({ societies }: { societies: SocietySummary[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [homeClub, setHomeClub] = useState("");
  const [busy, setBusy] = useState<"join" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy("join");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/societies/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't join that society");
      setNotice(data.already ? `You are already a member of ${data.society.name}.` : `Welcome to ${data.society.name}.`);
      setCode("");
      router.push(`/societies/${data.society.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join that society");
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/societies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, homeClub: homeClub || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't start that society");
      router.push(`/societies/${data.society.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start that society");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Societies</h1>
        <p className="mt-1 text-[14px] text-ink/55">
          A society keeps its own fixture list, roster and season order of merit. Golf days you run from a society page are
          added to its list automatically.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">{notice}</p>}

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink/[0.06] px-5 py-3.5">
            <h2 className="text-[15px] font-bold">My societies</h2>
            <span className="text-[12px] text-ink/45">{societies.length}</span>
          </div>
          <ul className="divide-y divide-ink/[0.06]">
            {societies.map((society) => (
              <li key={society.id}>
                <Link href={`/societies/${society.slug}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink/[0.02]">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fairway-700 text-[13px] font-bold text-white">
                    {society.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{society.name}</div>
                    <div className="truncate text-[12px] text-ink/45">{society.homeClub ?? "No home club"}</div>
                  </div>
                  <span className={`pill ${society.role === "MEMBER" ? "bg-ink/[0.04] text-ink/60 ring-ink/10" : "bg-fairway-50 text-fairway-800 ring-fairway-200"}`}>
                    {society.role === "OWNER" ? "Owner" : society.role === "SECRETARY" ? "Secretary" : "Member"}
                  </span>
                </Link>
              </li>
            ))}
            {societies.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-ink/50">
                You are not in a society yet - join one with its code, or start your own.
              </li>
            )}
          </ul>
        </div>

        <div className="space-y-4">
          <form onSubmit={join} className="card card-pad space-y-3">
            <div>
              <h2 className="text-[15px] font-bold">Join a society</h2>
              <p className="text-[12.5px] text-ink/55">Ask the secretary for the six-character code.</p>
            </div>
            <div>
              <label className="label" htmlFor="join-code">Society code</label>
              <input
                id="join-code"
                className="input font-mono uppercase tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={12}
                placeholder="e.g. K7QM2P"
                required
              />
            </div>
            <button className="btn-primary w-full" disabled={busy !== null || code.trim().length < 4}>
              {busy === "join" ? "Joining…" : "Join"}
            </button>
          </form>

          <form onSubmit={create} className="card card-pad space-y-3">
            <div>
              <h2 className="text-[15px] font-bold">Start a society</h2>
              <p className="text-[12.5px] text-ink/55">You become the owner and get a code to share with the members.</p>
            </div>
            <div>
              <label className="label" htmlFor="society-name">Society name</label>
              <input id="society-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harrow Golf Society" required />
            </div>
            <div>
              <label className="label" htmlFor="society-club">Home club (optional)</label>
              <input id="society-club" className="input" value={homeClub} onChange={(e) => setHomeClub(e.target.value)} placeholder="e.g. Harrow Golf Club" />
            </div>
            <button className="btn-secondary w-full" disabled={busy !== null || name.trim().length < 2}>
              {busy === "create" ? "Starting…" : "Create society"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
