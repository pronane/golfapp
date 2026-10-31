"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { GameSettings, SideHole } from "@/lib/games";

type Player = { id: string; name: string; playingHandicap: number; groupId: string | null };
type PairRow = { id: string; name: string; playerA: string; playerB: string };

type Props = {
  eventId: string;
  holeCount: number;
  players: Player[];
};

const EMPTY: GameSettings = {
  skins: "OFF",
  skinsCarry: true,
  teamFormat: "NONE",
  sideHoles: [],
  sponsors: [],
  teamNames: ["Team A", "Team B"],
  matches: [],
  entryFeePence: 0,
};

/**
 * Organiser console "Games" tab: skins, nearest-the-pin / longest-drive holes,
 * team formats (4BBB pairs or Ryder Cup-style match play), sponsors and the
 * entry fee. Everything saves through PUT /api/events/:id/games.
 */
export function GamesConsole({ eventId, holeCount, players }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<GameSettings>(EMPTY);
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newSide, setNewSide] = useState<SideHole>({ kind: "NEAREST_PIN", holeNumber: 3 });
  const [sponsor, setSponsor] = useState({ name: "", url: "" });
  const [feeText, setFeeText] = useState("0");

  const names = new Map(players.map((p) => [p.id, p.name]));

  useEffect(() => {
    fetch(`/api/events/${eventId}/games`)
      .then((r) => r.json())
      .then((data) => {
        if (data.settings) {
          setSettings(data.settings);
          setFeeText(((data.settings.entryFeePence ?? 0) / 100).toFixed(2).replace(/\.00$/, ""));
        }
        setPairs(data.pairs ?? []);
        setLoaded(true);
      })
      .catch(() => setMessage({ ok: false, text: "Couldn't load the games settings" }));
  }, [eventId]);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      router.refresh();
      return data;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(next: GameSettings, note = "Games saved") {
    setSettings(next);
    const data = await send(`/api/events/${eventId}/games`, "PUT", next);
    if (data?.settings) {
      setSettings(data.settings);
      setMessage({ ok: true, text: note });
    }
  }

  /** Ryder Cup-style draw: rank by playing handicap, alternate into two teams, pair them as singles. */
  function autoDraw() {
    const sorted = [...players].sort((a, b) => a.playingHandicap - b.playingHandicap);
    const teamA: Player[] = [];
    const teamB: Player[] = [];
    sorted.forEach((p, i) => ((i % 4 === 0 || i % 4 === 3) ? teamA : teamB).push(p));
    const n = Math.min(teamA.length, teamB.length);
    const matches = Array.from({ length: n }, (_, i) => ({
      id: `m${i + 1}`,
      name: `Match ${i + 1}`,
      sideA: [teamA[i].id],
      sideB: [teamB[i].id],
    }));
    void save({ ...settings, teamFormat: "MATCHPLAY", matches }, `Drew ${n} singles matches`);
  }

  if (!loaded) return <section className="card card-pad text-[13px] text-ink/60">Loading games…</section>;

  const inMatch = new Set(settings.matches.flatMap((m) => [...m.sideA, ...m.sideB]));

  return (
    <div className="space-y-4">
      {message && (
        <div role="status" className={`rounded-xl px-4 py-2.5 text-[13px] font-medium ${message.ok ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" : "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200"}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad space-y-3">
          <h2 className="text-[15px] font-bold">Skins</h2>
          <p className="text-[12.5px] text-ink/60">Lowest score on a hole wins it outright; a tie carries the skin on.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="g-skins">Skins game</label>
              <select id="g-skins" className="select" value={settings.skins} disabled={busy}
                onChange={(e) => void save({ ...settings, skins: e.target.value as GameSettings["skins"] })}>
                <option value="OFF">Off</option>
                <option value="NET">Net skins</option>
                <option value="GROSS">Gross skins</option>
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" className="h-4 w-4 rounded accent-fairway-700" checked={settings.skinsCarry} disabled={busy || settings.skins === "OFF"}
                onChange={(e) => void save({ ...settings, skinsCarry: e.target.checked })} />
              Carry halved holes over
            </label>
          </div>
        </section>

        <section className="card card-pad space-y-3">
          <h2 className="text-[15px] font-bold">Nearest the pin &amp; longest drive</h2>
          <ul className="space-y-1.5">
            {settings.sideHoles.map((h) => (
              <li key={`${h.kind}-${h.holeNumber}`} className="flex items-center justify-between rounded-lg bg-ink/[0.03] px-3 py-1.5 text-[13px]">
                <span>{h.kind === "NEAREST_PIN" ? "Nearest the pin" : "Longest drive"} · hole {h.holeNumber}</span>
                <button className="text-[12px] font-semibold text-rose-600 hover:underline" disabled={busy}
                  onClick={() => void save({ ...settings, sideHoles: settings.sideHoles.filter((x) => x !== h) })}>
                  Remove
                </button>
              </li>
            ))}
            {settings.sideHoles.length === 0 && <li className="text-[12.5px] text-ink/60">None yet - par 3s suit nearest the pin, long par 5s the drive.</li>}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="g-kind">Game</label>
              <select id="g-kind" className="select" value={newSide.kind} onChange={(e) => setNewSide({ ...newSide, kind: e.target.value as SideHole["kind"] })}>
                <option value="NEAREST_PIN">Nearest the pin</option>
                <option value="LONGEST_DRIVE">Longest drive</option>
              </select>
            </div>
            <div className="w-24">
              <label className="label" htmlFor="g-hole">Hole</label>
              <input id="g-hole" type="number" min={1} max={holeCount} className="input" value={newSide.holeNumber}
                onChange={(e) => setNewSide({ ...newSide, holeNumber: Number(e.target.value) })} />
            </div>
            <button className="btn-secondary btn-sm" disabled={busy}
              onClick={() => void save({ ...settings, sideHoles: [...settings.sideHoles, newSide] }, "Side game added")}>
              Add
            </button>
          </div>
        </section>
      </div>

      <section className="card card-pad space-y-3">
        <h2 className="text-[15px] font-bold">Team game</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Team game">
          {([
            ["NONE", "None"],
            ["FOURBBB", "Better-ball pairs (4BBB)"],
            ["MATCHPLAY", "Ryder Cup match play"],
          ] as const).map(([value, label]) => (
            <button key={value} role="radio" aria-checked={settings.teamFormat === value} disabled={busy}
              onClick={() => void save({ ...settings, teamFormat: value })}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ring-1 ring-inset ${settings.teamFormat === value ? "bg-fairway-700 text-white ring-fairway-700" : "text-ink/70 ring-ink/15 hover:bg-ink/[0.04]"}`}>
              {label}
            </button>
          ))}
        </div>

        {settings.teamFormat === "FOURBBB" && (
          <div className="space-y-2">
            <p className="text-[12.5px] text-ink/60">Each hole counts the better of the two partners&apos; Stableford points.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary btn-sm" disabled={busy}
                onClick={async () => {
                  const data = await send(`/api/events/${eventId}/pairs`, "POST", { auto: true });
                  if (data) { setPairs(data.pairs ?? []); setMessage({ ok: true, text: "Paired each tee group 1+2, 3+4" }); }
                }}>
                Pair from tee groups
              </button>
              {pairs.length > 0 && (
                <button className="btn-secondary btn-sm" disabled={busy}
                  onClick={async () => { if (await send(`/api/events/${eventId}/pairs`, "DELETE")) setPairs([]); }}>
                  Clear pairs
                </button>
              )}
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {pairs.map((p) => (
                <li key={p.id} className="rounded-lg bg-ink/[0.03] px-3 py-1.5 text-[13px]">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-ink/60"> · {names.get(p.playerA) ?? "?"} &amp; {names.get(p.playerB) ?? "?"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {settings.teamFormat === "MATCHPLAY" && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink/60">
              Singles or fourball (two a side) off the low handicap. A win is 1 point, a half ½. The board shows live and banked points.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i}>
                  <label className="label" htmlFor={`g-team-${i}`}>Team {i === 0 ? "A" : "B"} name</label>
                  <input id={`g-team-${i}`} className="input" value={settings.teamNames[i]}
                    onChange={(e) => {
                      const teamNames = [...settings.teamNames] as [string, string];
                      teamNames[i] = e.target.value;
                      setSettings({ ...settings, teamNames });
                    }}
                    onBlur={() => void save(settings, "Team names saved")} />
                </div>
              ))}
            </div>
            <ul className="space-y-1.5">
              {settings.matches.map((m, index) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink/[0.03] px-3 py-2 text-[13px]">
                  <span className="w-20 font-semibold">{m.name}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {m.sideA.map((id) => names.get(id) ?? "?").join(" & ")}
                    <span className="px-1.5 text-ink/50">v</span>
                    {m.sideB.map((id) => names.get(id) ?? "?").join(" & ")}
                  </span>
                  <button className="text-[12px] font-semibold text-rose-600 hover:underline" disabled={busy}
                    onClick={() => void save({ ...settings, matches: settings.matches.filter((_, j) => j !== index) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <MatchBuilder
              players={players.filter((p) => !inMatch.has(p.id))}
              teamNames={settings.teamNames}
              disabled={busy}
              onAdd={(sideA, sideB) => {
                const n = settings.matches.length + 1;
                void save({ ...settings, matches: [...settings.matches, { id: `m${Date.now().toString(36)}`, name: `Match ${n}`, sideA, sideB }] }, "Match added");
              }}
            />
            <button className="btn-secondary btn-sm" disabled={busy || players.length < 2} onClick={autoDraw}>
              Auto-draw balanced singles
            </button>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad space-y-3">
          <h2 className="text-[15px] font-bold">Sponsors</h2>
          <p className="text-[12.5px] text-ink/60">Shown along the live board and on the clubhouse TV screen. Up to 8.</p>
          <ul className="space-y-1.5">
            {settings.sponsors.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex items-center justify-between rounded-lg bg-ink/[0.03] px-3 py-1.5 text-[13px]">
                <span className="truncate">{s.name}{s.url ? <span className="text-ink/50"> · {s.url}</span> : null}</span>
                <button className="text-[12px] font-semibold text-rose-600 hover:underline" disabled={busy}
                  onClick={() => void save({ ...settings, sponsors: settings.sponsors.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className="input" aria-label="Sponsor name" placeholder="Hole sponsor name" value={sponsor.name} onChange={(e) => setSponsor({ ...sponsor, name: e.target.value })} />
            <input className="input" aria-label="Sponsor website" placeholder="https://… (optional)" value={sponsor.url} onChange={(e) => setSponsor({ ...sponsor, url: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy || !sponsor.name.trim() || settings.sponsors.length >= 8}
              onClick={async () => {
                await save({ ...settings, sponsors: [...settings.sponsors, { name: sponsor.name, url: sponsor.url || undefined }] }, "Sponsor added");
                setSponsor({ name: "", url: "" });
              }}>
              Add
            </button>
          </div>
        </section>

        <section className="card card-pad space-y-3">
          <h2 className="text-[15px] font-bold">Entry fee</h2>
          <p className="text-[12.5px] text-ink/60">Players see a &ldquo;Pay entry&rdquo; button on the event page. Track who has paid in the Payments tab.</p>
          <div className="flex items-end gap-2">
            <div className="w-36">
              <label className="label" htmlFor="g-fee">Fee (£)</label>
              <input id="g-fee" inputMode="decimal" className="input" value={feeText} onChange={(e) => setFeeText(e.target.value)} />
            </div>
            <button className="btn-primary btn-sm" disabled={busy}
              onClick={() => {
                const pence = Math.round(Number(feeText.replace(/[£,\s]/g, "")) * 100);
                if (!Number.isFinite(pence) || pence < 0) { setMessage({ ok: false, text: "Enter the fee in pounds, e.g. 25" }); return; }
                void save({ ...settings, entryFeePence: pence }, pence ? "Entry fee saved" : "Entry is free");
              }}>
              Save fee
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function MatchBuilder({
  players,
  teamNames,
  disabled,
  onAdd,
}: {
  players: Player[];
  teamNames: [string, string];
  disabled: boolean;
  onAdd: (sideA: string[], sideB: string[]) => void;
}) {
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");
  const [b1, setB1] = useState("");
  const [b2, setB2] = useState("");
  const chosen = [a1, a2, b1, b2].filter(Boolean);
  const valid = Boolean(a1 && b1) && new Set(chosen).size === chosen.length;

  const pick = (id: string, value: string, set: (v: string) => void, label: string, optional = false) => (
    <select id={id} aria-label={label} className="select" value={value} onChange={(e) => set(e.target.value)}>
      <option value="">{optional ? "— (singles)" : "Choose…"}</option>
      {players.map((p) => (
        <option key={p.id} value={p.id}>{p.name} · PH {p.playingHandicap}</option>
      ))}
    </select>
  );

  return (
    <div className="rounded-xl ring-1 ring-inset ring-ink/10 p-3">
      <p className="text-[12.5px] font-semibold">Add a match</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink/60">{teamNames[0]}</p>
          {pick("mb-a1", a1, setA1, `${teamNames[0]} player 1`)}
          {pick("mb-a2", a2, setA2, `${teamNames[0]} partner`, true)}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink/60">{teamNames[1]}</p>
          {pick("mb-b1", b1, setB1, `${teamNames[1]} player 1`)}
          {pick("mb-b2", b2, setB2, `${teamNames[1]} partner`, true)}
        </div>
      </div>
      <button className="btn-primary btn-sm mt-2" disabled={disabled || !valid}
        onClick={() => {
          onAdd([a1, a2].filter(Boolean), [b1, b2].filter(Boolean));
          setA1(""); setA2(""); setB1(""); setB2("");
        }}>
        Add match
      </button>
    </div>
  );
}
