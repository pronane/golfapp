"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card card-pad"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        const res = await fetch("/api/events/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        setBusy(false);
        if (!res.ok) { setMessage(data.error ?? "Could not join"); return; }
        router.push(`/events/${data.slug}`);
        router.refresh();
      }}
    >
      <h2 className="text-[15px] font-bold">Have a join code?</h2>
      <p className="mt-1 text-[12.5px] text-ink/55">Your organiser shares a 6-character code - enter it here to put yourself in the field.</p>
      <div className="mt-3 flex gap-2">
        <input
          className="input font-mono uppercase tracking-[0.2em]"
          value={code}
          maxLength={8}
          placeholder="A1B2C3"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn-primary btn-sm shrink-0" disabled={busy || code.length < 4}>Enter</button>
      </div>
      {message && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{message}</p>}
    </form>
  );
}
