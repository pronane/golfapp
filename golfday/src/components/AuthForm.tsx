"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FlagMark } from "./Icons";
import { SELECTABLE_PROVENANCES, provenanceMeta } from "@/lib/handicapProvenance";

type Mode = "login" | "register";

const SIGN_IN_ERRORS: Record<string, string> = {
  provider_unavailable: "That sign-in provider is not configured on this server.",
  sign_in_cancelled: "That sign-in was cancelled.",
  sign_in_expired: "That sign-in took too long - please try again.",
  sign_in_state_mismatch: "That sign-in could not be verified. Please try again.",
  sign_in_no_code: "The provider did not return an authorisation code.",
  sign_in_failed: "That sign-in did not complete. Please try again.",
  oauth_unverified_email:
    "That account did not share a verified email address, so it cannot be matched to a GolfDay account. Sign in with email and password instead.",
  oauth_provider_conflict: "That email already signs in with a different provider.",
};

export function AuthForm({
  mode,
  providers = [],
}: {
  mode: Mode;
  providers?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const paramError = params.get("error");
  const paramDetail = params.get("detail");
  const [socialError] = useState<string | null>(
    paramError ? paramDetail || SIGN_IN_ERRORS[paramError] || "That sign-in did not complete." : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(socialError);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    handicapIndex: "",
    homeClub: "",
    golfEnglandId: "",
    handicapSource: "WHS",
    handicapNote: "",
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
              handicapSource: form.handicapSource,
              handicapNote: form.handicapNote || undefined,
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.player) {
      setLookup(data.notice ?? data.error ?? "No golfer found for that ID");
      return;
    }
    if (data.player) {
      setForm((prev) => ({
        ...prev,
        name: prev.name || data.player.name,
        homeClub: data.player.homeClub,
        handicapIndex: String(data.player.handicapIndex),
      }));
      setLookup(`Found ${data.player.name} · HI ${data.player.handicapIndex} · ${data.player.homeClub}`);
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
                <label className="label" htmlFor="handicap-source">Where does your handicap come from?</label>
                <select
                  id="handicap-source"
                  className="select"
                  value={form.handicapSource}
                  onChange={(e) => setForm((prev) => ({ ...prev, handicapSource: e.target.value }))}
                >
                  {SELECTABLE_PROVENANCES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11.5px] text-ink/50">{provenanceMeta(form.handicapSource).blurb}</p>

                {form.handicapSource !== "NONE" && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="hcp">Handicap index</label>
                      <input id="hcp" type="number" step="0.1" className="input" value={form.handicapIndex} onChange={set("handicapIndex")} placeholder="12.4" />
                    </div>
                    <div>
                      <label className="label" htmlFor="club">Home club</label>
                      <input id="club" className="input" value={form.homeClub} onChange={set("homeClub")} placeholder="Sunningdale (optional)" />
                    </div>
                  </div>
                )}

                {provenanceMeta(form.handicapSource).wantsId && (
                  <div className="mt-3">
                    <label className="label" htmlFor="ge">
                      {form.handicapSource === "WHS" ? "Golf England / CDH ID" : "Handicap ID"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="ge"
                        className="input"
                        value={form.golfEnglandId}
                        onChange={set("golfEnglandId")}
                        placeholder={provenanceMeta(form.handicapSource).notePlaceholder ?? "optional"}
                      />
                      {form.handicapSource === "WHS" && (
                        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={golfEnglandLookup}>Look up</button>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-ink/50">
                      {lookup ??
                        (form.handicapSource === "WHS"
                          ? "We pull your WHS handicap index so organisers do not have to type it."
                          : "Optional - the number on your handicap record, so an organiser can check it.")}
                    </p>
                  </div>
                )}

                {form.handicapSource !== "WHS" && (
                  <div className="mt-3">
                    <label className="label" htmlFor="hcp-note">Anything else (optional)</label>
                    <input
                      id="hcp-note"
                      className="input"
                      value={form.handicapNote}
                      onChange={set("handicapNote")}
                      placeholder={provenanceMeta(form.handicapSource).notePlaceholder ?? "optional"}
                    />
                  </div>
                )}

                <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
                  No club or national handicap? Pick <strong>No handicap yet</strong> or <strong>Society or
                  committee handicap</strong> - you can still enter any golf day, and an organiser can adjust your
                  index when you have one.
                </p>
              </div>
            </>
          )}

          {error && <div className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700 ring-1 ring-inset ring-rose-200">{error}</div>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Just a moment…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {providers.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-ink/10" />
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink/40">or continue with</span>
              <span className="h-px flex-1 bg-ink/10" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {providers.map((provider) => (
                <a
                  key={provider.id}
                  href={`/api/auth/oauth/${provider.id}/start?next=${encodeURIComponent(next)}`}
                  className="btn-secondary btn-sm flex-1 justify-center whitespace-nowrap"
                >
                  {provider.label}
                </a>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-ink/45">
              First time? A social sign-in creates your player account with the email that provider shares.
            </p>
          </div>
        )}

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
