"use client";

import { useState } from "react";

/** Sends the player to Stripe Checkout for their entry fee. */
export function PayEntryButton({ eventId, label }: { eventId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2">
      <button
        className="btn-sand btn-sm w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/events/${eventId}/payments/checkout`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't start the payment");
            window.location.assign(data.url);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't start the payment");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening checkout…" : label}
      </button>
      {error && <p role="alert" className="mt-1 text-[12px] text-rose-700">{error}</p>}
    </div>
  );
}
