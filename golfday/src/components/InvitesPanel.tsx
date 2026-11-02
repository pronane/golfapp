"use client";

import { useEffect, useState } from "react";

type MailRow = { id: string; toName: string | null; toEmail: string; subject: string; status: string; error: string | null; createdAt: string };
type Summary = {
  delivered: boolean;
  sent: number;
  dryRun: number;
  failed: number;
  noEmail: { playerId: string; name: string }[];
  results: { seat: { playerId: string; name: string; email: string }; status: string; error?: string }[];
};

/**
 * Email the field their tee group and card link.
 *
 * Says exactly what happened: with no mail provider configured the batch is
 * recorded as a dry run and the panel tells the organiser to send the links by
 * hand, rather than showing a cheerful "19 sent" that never happened.
 */
export function InvitesPanel({ eventId }: { eventId: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<MailRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/events/${eventId}/invites`);
    if (!res.ok) return;
    const data = await res.json();
    setConfigured(Boolean(data.configured));
    setMessages(data.messages ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function send() {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/events/${eventId}/invites`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send the invitations");
      setSummary(data);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invitations");
    } finally {
      setBusy(false);
    }
  }

  const recent = messages.slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold">Invitations</h2>
          <p className="text-[12.5px] text-ink/55">
            {configured
              ? "Emails each player their tee group, tee time and card link."
              : "Each player's message is written and recorded here. No mail provider is configured, so nothing is sent - use Copy message to pass them on."}
          </p>
        </div>
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => void send()}>
          {busy ? "Preparing…" : configured ? "Email the field" : "Write the invitations"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
          {error}
        </p>
      )}

      {summary && (
        <div className="rounded-xl bg-ink/[0.03] px-3 py-2.5 text-[12.5px]">
          {summary.delivered ? (
            <p className="font-medium text-emerald-700">
              {summary.sent} invitation{summary.sent === 1 ? "" : "s"} emailed
              {summary.failed > 0 ? `, ${summary.failed} failed` : ""}.
            </p>
          ) : (
            <p className="font-medium text-sand-700">
              {summary.dryRun} invitation{summary.dryRun === 1 ? "" : "s"} written and saved, not sent - no mail provider
              is configured on this host.
            </p>
          )}
          {summary.noEmail.length > 0 && (
            <p className="mt-1 text-ink/60">
              No address on file for {summary.noEmail.length}: {summary.noEmail.map((row) => row.name).join(", ")}.
            </p>
          )}
          {summary.results.some((row) => row.status === "FAILED") && (
            <ul className="mt-1 space-y-0.5 text-rose-700">
              {summary.results
                .filter((row) => row.status === "FAILED")
                .slice(0, 5)
                .map((row) => (
                  <li key={row.seat.playerId}>
                    {row.seat.name} ({row.seat.email}): {row.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <ul className="divide-y divide-ink/[0.06] rounded-xl ring-1 ring-inset ring-ink/[0.08]">
          {recent.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
              <span className="min-w-0">
                <span className="font-semibold">{row.toName ?? row.toEmail}</span>
                <span className="text-ink/45"> · {row.subject}</span>
              </span>
              <span
                className={`pill ${
                  row.status === "SENT"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : row.status === "FAILED"
                      ? "bg-rose-50 text-rose-700 ring-rose-200"
                      : "bg-ink/[0.04] text-ink/60 ring-ink/10"
                }`}
              >
                {row.status === "DRY_RUN" ? "not sent" : row.status.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
