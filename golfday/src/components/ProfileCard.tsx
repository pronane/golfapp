"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SELECTABLE_PROVENANCES, provenanceMeta } from "@/lib/handicapProvenance";

type Player = {
  id: string;
  name: string;
  handicapIndex: number;
  homeClub: string | null;
  golfEnglandId: string | null;
  handicapSource: string;
  handicapVerified: boolean;
  handicapNote: string | null;
  handicapUpdatedAt: string | null;
};

export function ProfileCard({ player }: { player: Player | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [handicap, setHandicap] = useState(String(player?.handicapIndex ?? 0));
  const [geId, setGeId] = useState(player?.golfEnglandId ?? "");
  const [source, setSource] = useState(player?.handicapSource ?? "MANUAL");
  const [note, setNote] = useState(player?.handicapNote ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, note: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/players/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setMessage(data.error ?? "Update failed"); return; }
    setMessage(note);
    setEditing(false);
    router.refresh();
  }

  if (!player) {
    return (
      <div className="card card-pad">
        <h2 className="text-[15px] font-bold">Player profile</h2>
        <p className="mt-1 text-[13px] text-ink/60">This account has no player profile yet.</p>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-bold">Player profile</h2>
          <p className="text-[12.5px] text-ink/50">Used to calculate your course handicap on every event.</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-fairway-50 px-2 py-3 ring-1 ring-inset ring-fairway-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-fairway-700/70">Index</div>
          <div className="mt-0.5 text-2xl font-extrabold tracking-tight text-fairway-900">{player.handicapIndex.toFixed(1)}</div>
        </div>
        <div className="col-span-2 rounded-xl bg-ink/[0.03] px-3 py-3 text-left ring-1 ring-inset ring-ink/[0.06]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">Club</div>
          <div className="mt-0.5 truncate text-[14px] font-semibold">{player.homeClub ?? "—"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink/50">
            <span className="rounded-full bg-ink/[0.06] px-1.5 py-0.5 font-semibold text-ink/60">
              {provenanceMeta(player.handicapSource).short}
            </span>
            <span>
              {player.handicapSource === "NONE"
                ? "plays off scratch"
                : player.handicapVerified
                  ? "verified"
                  : provenanceMeta(player.handicapSource).official
                    ? "declared, not verified"
                    : "self-declared"}
            </span>
            {player.golfEnglandId && <span>· {player.golfEnglandId}</span>}
          </div>
          {player.handicapNote && <div className="mt-0.5 truncate text-[11.5px] text-ink/45">{player.handicapNote}</div>}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-ink/10">
          <div>
            <label className="label" htmlFor="source">Where does your handicap come from?</label>
            <select id="source" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              {SELECTABLE_PROVENANCES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11.5px] text-ink/50">{provenanceMeta(source).blurb}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="hi">Handicap index</label>
              <input id="hi" type="number" step="0.1" className="input" value={handicap} onChange={(e) => setHandicap(e.target.value)} disabled={source === "NONE"} />
            </div>
            <div>
              <label className="label" htmlFor="geid">Handicap ID</label>
              <input id="geid" className="input" value={geId} onChange={(e) => setGeId(e.target.value)} placeholder={provenanceMeta(source).notePlaceholder ?? "optional"} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="note">Note for organisers (optional)</label>
              <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={provenanceMeta(source).notePlaceholder ?? "optional"} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary btn-sm"
              disabled={busy}
              onClick={() =>
                patch(
                  { handicapSource: source, handicapNote: note, golfEnglandId: geId, ...(source === "NONE" ? { handicapIndex: 0 } : { handicapIndex: Number(handicap) }) },
                  "Handicap saved",
                )
              }
            >
              Save
            </button>
            {provenanceMeta(source).lookupable && (
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => patch({ golfEnglandId: geId, refreshFromGolfEngland: true }, "Handicap refreshed from the national database")}>
                Refresh from Golf England
              </button>
            )}
          </div>
          {source === "NONE" && (
            <p className="text-[11.5px] text-ink/50">No handicap yet means scratch (0). You can still be entered in any golf day.</p>
          )}
        </div>
      )}
      {message && <p className="mt-3 rounded-lg bg-fairway-50 px-3 py-2 text-[12.5px] text-fairway-800">{message}</p>}
    </div>
  );
}
