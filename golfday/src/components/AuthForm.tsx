"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FlagMark } from "./Icons";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    handicapIndex: "",
    homeClub: "",
    golfEnglandId: "",
  });
  const [lookup, setLookup] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : {
              name: form.name,
              email: form.email,
              password: form.password,
              handicapIndex: form.handicapIndex ? Number(form.handicapIndex) : undefined,
              homeClub: form.homeClub || undefined,
              golfEnglandId: form.golfEnglandId || undefined,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function golfEnglandLookup() {
    if (!form.golfEnglandId) return;
    setLookup("Looking up…");
    const res = await fetch(`/api/golfengland/search?id=${encodeURIComponent(form.golfEnglandId)}`);
    const data = await res.json();
    if (data.player) {
      setForm((prev) => ({
        ...prev,
        name: prev.name || data.player.name,
        homeClub: data.player.homeClub,
        handicapIndex: String(data.player.handicapIndex),
      }));
      setLookup(`Found ${data.player.name} · HI ${data.player.handicapIndex} · ${data.player.homeClub}`);
    } else {
      setLookup("No golfer found for that ID");
    }
  }

  async function demo(email: string) {
    setBusy(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "golfday123" }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      setError("Demo account is not seeded in this database");
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-6 lg:grid-cols-[1fr_0.9fr]">
      <div className="card card-pad">
        <div className="mb-6 flex items-center gap-2.5">
          <FlagMark className="h-9 w-9" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {mode === "login" ? "Welcome back" : "Create your player account"}
            </h1>
            <p className="text-[13px] text-ink/55">
              {mode === "login" ? "Sign in to enter a golf day or run one." : "One account, every golf day you play."}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="label" htmlFor="name">Full name</label>
              <input id="name" className="input" value={form.name} onChange={set("name")} placeholder="Sam Whitcombe" required />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={form.email} onChange={set("email")} placeholder="you@club.co.uk" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" className="input" value={form.password} onChange={set("password")} placeholder={mode === "register" ? "At least 8 characters" : "••••••••"} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>

          {mode === "register" && (
            <>
              <div className="rounded-xl bg-fairway-50/70 p-3 ring-1 ring-inset ring-fairway-100">
                <label className="label" htmlFor="ge">Golf England ID (optional)</label>
                <div className="flex gap-2">
                  <input id="ge" className="input" value={form.golfEnglandId} onChange={set("golfEnglandId")} placeholder="GE100241" />
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={golfEnglandLookup}>Look up</button>
                </div>
                <p className="mt-1.5 text-[11.5px] text-ink/50">
                  {lookup ?? "We pull your WHS handicap index so event admins do not have to type it."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="hcp">Handicap index</label>
                  <input id="hcp" type="number" step="0.1" className="input" value={form.handicapIndex} onChange={set("handicapIndex")} placeholder="12.4" />
                </div>
                <div>
                  <label className="label" htmlFor="club">Home club</label>
                  <input id="club" className="input" value={form.homeClub} onChange={set("homeClub")} placeholder="Sunningdale" />
                </div>
              </div>
            </>
          )}

          {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 ring-1 ring-inset ring-rose-200">{error}</div>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Just a moment…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[13px] text-ink/55">
          {mode === "login" ? (
            <>New here? <Link href="/register" className="link">Create an account</Link></>
          ) : (
            <>Already have an account? <Link href="/login" className="link">Sign in</Link></>
          )}
        </p>
      </div>

      <div className="card card-pad bg-fairway-950 text-white">
        <h2 className="text-[15px] font-bold">Demo accounts</h2>
        <p className="mt-1 text-[13px] text-fairway-100/70">Jump straight into a golf day that is already in play.</p>
        <div className="mt-4 space-y-2">
          <button onClick={() => demo("admin@golfday.app")} className="w-full rounded-xl bg-white/[0.07] p-3 text-left ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.12]">
            <div className="text-[13.5px] font-semibold">Alex Morgan</div>
            <div className="text-[11.5px] text-fairway-100/60">Event admin · admin@golfday.app</div>
          </button>
          <button onClick={() => demo("sam@golfday.app")} className="w-full rounded-xl bg-white/[0.07] p-3 text-left ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.12]">
            <div className="text-[13.5px] font-semibold">Sam Whitcombe</div>
            <div className="text-[11.5px] text-fairway-100/60">Player · sam@golfday.app</div>
          </button>
        </div>
        <div className="mt-5 rounded-xl bg-black/20 p-3 text-[12px] leading-relaxed text-fairway-100/70">
          Password for every demo account is <span className="font-mono text-sand-300">golfday123</span>.
          The Autumn Invitational is live today with three groups on the course.
        </div>
      </div>
    </div>
  );
}
