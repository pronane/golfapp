"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  playerId: string;
  name: string;
  status: "PAID" | "PENDING" | "UNPAID";
  method: "MANUAL" | "STRIPE" | null;
  amountPence: number;
  paidAt: string | null;
};

type Data = { feePence: number; stripeEnabled: boolean; collectedPence: number; rows: Row[] };

const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);

/** Organiser console "Payments" tab: who has paid the entry fee, with a manual override. */
export function PaymentsPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/payments`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? "Couldn't load payments");
    else setData(body as Data);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mark(playerId: string, paid: boolean) {
    setBusyId(playerId);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/payments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, paid }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? "Couldn't update that payment");
    await load();
    setBusyId(null);
  }

  if (error && !data) return <section className="card card-pad text-[13px] text-rose-700">{error}</section>;
  if (!data) return <section className="card card-pad text-[13px] text-ink/60">Loading payments…</section>;

  const paid = data.rows.filter((r) => r.status === "PAID").length;
  const expected = data.feePence * data.rows.length;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/[0.06] px-5 py-4">
        <div>
          <h2 className="text-[15px] font-bold">Entry fees</h2>
          <p className="text-[12.5px] text-ink/60">
            {data.feePence === 0
              ? "This event is free - set a fee in the Games tab."
              : `${gbp(data.feePence)} a head · ${paid} of ${data.rows.length} paid · ${gbp(data.collectedPence)} of ${gbp(expected)} collected`}
          </p>
        </div>
        <span className={`pill ${data.stripeEnabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-ink/[0.04] text-ink/60 ring-ink/10"}`}>
          {data.stripeEnabled ? "Card payments on (Stripe)" : "Card payments off - mark cash and transfers here"}
        </span>
      </div>
      {error && <p role="alert" className="bg-rose-50 px-5 py-2 text-[12.5px] text-rose-700">{error}</p>}
      <table className="table-base">
        <thead>
          <tr>
            <th>Player</th>
            <th>Status</th>
            <th className="hidden sm:table-cell">How</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.playerId}>
              <td className="font-semibold">{r.name}</td>
              <td>
                <span className={`pill ${r.status === "PAID" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : r.status === "PENDING" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-ink/[0.04] text-ink/60 ring-ink/10"}`}>
                  {r.status === "PAID" ? `Paid ${gbp(r.amountPence)}` : r.status === "PENDING" ? "Checkout started" : "Unpaid"}
                </span>
              </td>
              <td className="hidden text-[12.5px] text-ink/60 sm:table-cell">
                {r.method === "STRIPE" ? "Card" : r.method === "MANUAL" ? "Marked by organiser" : "—"}
              </td>
              <td className="text-right">
                <button
                  className="text-[12.5px] font-semibold text-fairway-700 hover:underline disabled:opacity-50"
                  disabled={busyId === r.playerId || data.feePence === 0}
                  onClick={() => void mark(r.playerId, r.status !== "PAID")}
                >
                  {r.status === "PAID" ? "Mark unpaid" : "Mark paid"}
                </button>
              </td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-[13px] text-ink/60">Nobody has entered yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
