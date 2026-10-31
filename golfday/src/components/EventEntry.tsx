"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  eventId: string;
  playerId: string | null;
  registered: boolean;
  canSelfEnter: boolean;
  groups: { id: string; name: string; teeTime: string | null }[];
  myGroupId: string | null;
  isAdmin: boolean;
};

export function EventEntry({ eventId, playerId, registered, canSelfEnter, groups, myGroupId, isAdmin }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Something went wrong"); return false; }
    router.refresh();
    return true;
  }

  if (!playerId) {
    return (
      <div className="rounded-xl bg-ink/[0.03] px-3 py-2.5 text-[12.5px] text-ink/60">
        Sign in with a player account to enter. Organisers can add you without an account.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {registered ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill bg-fairway-50 text-fairway-700 ring-fairway-200">You&apos;re in the field</span>
            <button className="btn-secondary btn-sm" disabled={busy} onClick={() => call(`/api/events/${eventId}/players/${playerId}`, "DELETE")}>
              Withdraw
            </button>
          </div>
          {groups.length > 0 && (
            <label className="block">
              <span className="label">My tee group {isAdmin ? "(you can move yourself)" : ""}</span>
              <select
                className="select"
                value={myGroupId ?? ""}
                disabled={busy}
                onChange={async (event) => {
                  const value = event.target.value;
                  if (value) await call(`/api/events/${eventId}/groups/${value}`, "POST", { playerId, action: "add" });
                  else if (myGroupId) await call(`/api/events/${eventId}/groups/${myGroupId}`, "POST", { playerId, action: "remove" });
                }}
              >
                <option value="">Unassigned</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}{g.teeTime ? ` · ${g.teeTime}` : ""}</option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : canSelfEnter ? (
        <button
          className="btn-primary w-full"
          disabled={busy}
          onClick={() => call(`/api/events/${eventId}/players`, "POST", { playerId })}
        >
          {busy ? "Entering…" : "Enter this golf day"}
        </button>
      ) : (
        <div className="rounded-xl bg-ink/[0.03] px-3 py-2.5 text-[12.5px] text-ink/60">
          Entries for this event are closed - ask the organiser to add you.
        </div>
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </div>
  );
}
