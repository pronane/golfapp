"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Player = {
  id: string;
  name: string;
  handicapIndex: number;
  homeClub: string | null;
  golfEnglandId: string | null;
  handicapSource: string;
  handicapUpdatedAt: string | null;
};

export function ProfileCard({ player }: { player: Player | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [handicap, setHandicap] = useState(String(player?.handicapIndex ?? 0));
  const [geId, setGeId] = useState(player?.golfEnglandId ?? "");
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
          <div className="mt-0.5 truncate text-[11.5px] text-ink/50">
            Golf England {player.golfEnglandId ?? "not linked"} · {player.handicapSource.replace("_", " ").toLowerCase()}
          </div>
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-ink/10">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="hi">Handicap index</label>
              <input id="hi" type="number" step="0.1" className="input" value={handicap} onChange={(e) => setHandicap(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="geid">Golf England ID</label>
              <input id="geid" className="input" value={geId} onChange={(e) => setGeId(e.target.value)} placeholder="GE100241" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => patch({ handicapIndex: Number(handicap), golfEnglandId: geId }, "Handicap saved")}>Save</button>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => patch({ golfEnglandId: geId, refreshFromGolfEngland: true }, "Handicap refreshed from Golf England")}>
              Refresh from Golf England
            </button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 rounded-lg bg-fairway-50 px-3 py-2 text-[12.5px] text-fairway-800">{message}</p>}
    </div>
  );
}
