"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "PAID" | "PENDING" | "UNPAID" | "REFUNDED" | "PARTIALLY_REFUNDED";

type Row = {
  playerId: string;
  name: string;
  status: Status;
  method: "MANUAL" | "STRIPE" | null;
  amountPence: number;
  refundedPence: number;
  refundedAt: string | null;
  refundableByCard: boolean;
  paidAt: string | null;
};

type Refund = {
  id: string;
  playerId: string;
  amountPence: number;
  status: string;
  stripeRefundId: string | null;
  reason: string | null;
  createdAt: string;
};

type Data = {
  feePence: number;
  stripeEnabled: boolean;
  collectedPence: number;
  refundedPence: number;
  rows: Row[];
  refunds: Refund[];
};

const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100);

const REASONS = [
  { value: "requested_by_customer", label: "Player asked for it" },
  { value: "duplicate", label: "Duplicate entry" },
  { value: "fraudulent", label: "Fraudulent payment" },
];

/** Organiser console "Payments" tab: who has paid, manual override, refunds. */
export function PaymentsPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("requested_by_customer");
  const [notice, setNotice] = useState<string | null>(null);

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

  function openRefund(row: Row) {
    const remaining = row.amountPence - row.refundedPence;
    setRefundFor(row.playerId);
    setRefundAmount((remaining / 100).toFixed(2));
    setRefundReason("requested_by_customer");
    setError(null);
    setNotice(null);
  }

  async function refund(row: Row) {
    const pence = Math.round(Number(refundAmount) * 100);
    if (!(pence > 0)) {
      setError("Enter how much to refund");
      return;
    }
    setBusyId(row.playerId);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/payments/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: row.playerId, amountPence: pence, reason: refundReason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Couldn't refund that payment");
    } else {
      const outcome = body.refund as { amountPence: number; remainingPence: number };
      setNotice(
        `Refunded ${gbp(outcome.amountPence)} to ${row.name}.${
          outcome.remainingPence > 0 ? ` ${gbp(outcome.remainingPence)} still refundable.` : " Entry fee fully refunded."
        }`,
      );
      setRefundFor(null);
    }
    await load();
    setBusyId(null);
  }

  if (error && !data) return <section className="card card-pad text-[13px] text-rose-700">{error}</section>;
  if (!data) return <section className="card card-pad text-[13px] text-ink/60">Loading payments…</section>;

  const paid = data.rows.filter((r) => r.status === "PAID" || r.status === "PARTIALLY_REFUNDED").length;
  const expected = data.feePence * data.rows.length;
  const nameOf = new Map(data.rows.map((r) => [r.playerId, r.name]));

  const statusPill = (row: Row) => {
    if (row.status === "REFUNDED") return <span className="pill bg-rose-50 text-rose-700 ring-rose-200">Refunded {gbp(row.refundedPence)}</span>;
    if (row.status === "PARTIALLY_REFUNDED")
      return (
        <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
          {gbp(row.amountPence - row.refundedPence)} kept · {gbp(row.refundedPence)} refunded
        </span>
      );
    if (row.status === "PAID") return <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">Paid {gbp(row.amountPence)}</span>;
    if (row.status === "PENDING") return <span className="pill bg-amber-50 text-amber-800 ring-amber-200">Checkout started</span>;
    return <span className="pill bg-ink/[0.04] text-ink/60 ring-ink/10">Unpaid</span>;
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/[0.06] px-5 py-4">
        <div>
          <h2 className="text-[15px] font-bold">Entry fees</h2>
          <p className="text-[12.5px] text-ink/60">
            {data.feePence === 0
              ? "This event is free - set a fee in the Games tab."
              : `${gbp(data.feePence)} a head · ${paid} of ${data.rows.length} paid · ${gbp(data.collectedPence)} of ${gbp(expected)} in the bank${
                  data.refundedPence > 0 ? ` · ${gbp(data.refundedPence)} refunded` : ""
                }`}
          </p>
        </div>
        <span className={`pill ${data.stripeEnabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-ink/[0.04] text-ink/60 ring-ink/10"}`}>
          {data.stripeEnabled ? "Card payments on (Stripe)" : "Card payments off - mark cash and transfers here"}
        </span>
      </div>

      {error && <p role="alert" className="bg-rose-50 px-5 py-2 text-[12.5px] text-rose-700">{error}</p>}
      {notice && <p role="status" className="bg-emerald-50 px-5 py-2 text-[12.5px] text-emerald-800">{notice}</p>}

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
          {data.rows.map((r) => {
            const refundable = r.status === "PAID" || r.status === "PARTIALLY_REFUNDED";
            const remaining = r.amountPence - r.refundedPence;
            return (
              <tr key={r.playerId} className={refundFor === r.playerId ? "bg-ink/[0.02]" : ""}>
                <td className="font-semibold">{r.name}</td>
                <td>{statusPill(r)}</td>
                <td className="hidden text-[12.5px] text-ink/60 sm:table-cell">
                  {r.method === "STRIPE" ? "Card" : r.method === "MANUAL" ? "Marked by organiser" : "—"}
                </td>
                <td className="text-right">
                  <div className="flex flex-wrap justify-end gap-3">
                    {refundable && (
                      <button
                        className="text-[12.5px] font-semibold text-rose-700 hover:underline disabled:opacity-50"
                        disabled={busyId === r.playerId}
                        onClick={() => (refundFor === r.playerId ? setRefundFor(null) : openRefund(r))}
                      >
                        {refundFor === r.playerId ? "Cancel" : "Refund"}
                      </button>
                    )}
                    <button
                      className="text-[12.5px] font-semibold text-fairway-700 hover:underline disabled:opacity-50"
                      disabled={busyId === r.playerId || data.feePence === 0}
                      onClick={() => void mark(r.playerId, r.status !== "PAID" && r.status !== "PARTIALLY_REFUNDED")}
                    >
                      {r.status === "PAID" || r.status === "PARTIALLY_REFUNDED" ? "Mark unpaid" : "Mark paid"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-[13px] text-ink/60">Nobody has entered yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {refundFor && (() => {
        const row = data.rows.find((r) => r.playerId === refundFor);
        if (!row) return null;
        const remaining = row.amountPence - row.refundedPence;
        return (
          <div className="border-t border-rose-100 bg-rose-50/60 px-5 py-4">
            <h3 className="text-[13.5px] font-bold text-rose-900">Refund {row.name}</h3>
            <p className="text-[12px] text-rose-800/80">
              {row.method === "STRIPE"
                ? row.refundableByCard
                  ? `Sent back to the card through Stripe. ${gbp(remaining)} of ${gbp(row.amountPence)} is still refundable.`
                  : `Card payment, but Stripe has no PaymentIntent on file for it - refund it in the Stripe dashboard, then record the amount here. ${gbp(remaining)} of ${gbp(row.amountPence)} is still refundable.`
                : `Cash/transfer payment: this records the money as returned by hand. ${gbp(remaining)} of ${gbp(row.amountPence)} is still refundable.`}
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-32">
                <label className="label" htmlFor="refund-amount">Amount (£)</label>
                <input
                  id="refund-amount"
                  inputMode="decimal"
                  className="input"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>
              <div className="w-48">
                <label className="label" htmlFor="refund-reason">Reason</label>
                <select id="refund-reason" className="select" value={refundReason} onChange={(e) => setRefundReason(e.target.value)}>
                  {REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>{reason.label}</option>
                  ))}
                </select>
              </div>
              <button className="btn-primary btn-sm" disabled={busyId === row.playerId} onClick={() => void refund(row)}>
                {busyId === row.playerId ? "Refunding…" : `Refund ${gbp(Math.round(Number(refundAmount) * 100) || 0)}`}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setRefundFor(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {data.refunds.length > 0 && (
        <div className="border-t border-ink/[0.06] px-5 py-4">
          <h3 className="text-[13px] font-bold text-ink/70">Refund history</h3>
          <ul className="mt-2 space-y-1.5">
            {data.refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/[0.02] px-3 py-1.5 text-[12px]">
                <span className="font-semibold">{nameOf.get(r.playerId) ?? "Player"}</span>
                <span className="text-ink/60">
                  {gbp(r.amountPence)} · {REASONS.find((x) => x.value === r.reason)?.label ?? r.reason ?? "refund"}
                </span>
                <span className="font-mono text-[11px] text-ink/40">
                  {r.stripeRefundId ? r.stripeRefundId : "manual"} · {new Date(r.createdAt).toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
