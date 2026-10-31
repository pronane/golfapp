"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Guest players created by an organiser can link their record with a claim code. */
export function ClaimPlayer() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card card-pad"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        const res = await fetch("/api/players/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimCode: code }),
        });
        const data = await res.json();
        setBusy(false);
        if (!res.ok) { setMessage(data.error ?? "Could not link that code"); return; }
        setMessage("Linked - your entry history is now on this account.");
        router.refresh();
      }}
    >
      <h2 className="text-[15px] font-bold">Been added by an organiser?</h2>
      <p className="mt-1 text-[12.5px] text-ink/55">Enter the claim code from your entry confirmation to link their player record to this account.</p>
      <div className="mt-3 flex gap-2">
        <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC12345" maxLength={8} />
        <button className="btn-secondary btn-sm shrink-0" disabled={busy || code.length < 4}>Link</button>
      </div>
      {message && <p className="mt-2 text-[12.5px] text-ink/60">{message}</p>}
    </form>
  );
}
