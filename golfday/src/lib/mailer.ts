/**
 * Mail transport.
 *
 * Deliberately small and optional. With `RESEND_API_KEY` and `MAIL_FROM` set,
 * messages go out through Resend over its REST API (fetch, no SDK - the same
 * pattern as the Stripe calls). With nothing set, every message is still
 * composed, stored and shown to the organiser as a dry run, so the app is fully
 * usable on a free host with no mail account and never silently pretends to
 * have sent something.
 *
 * Nothing in here touches the database; `sendInvites` in ./invites does that.
 */
export type MailMessage = {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
};

export type MailResult =
  | { status: "SENT"; providerId: string | null }
  | { status: "DRY_RUN"; providerId: null }
  | { status: "FAILED"; providerId: null; error: string };

const RESEND_API = "https://api.resend.com/emails";

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim());
}

/** Where replies go, if anybody said. */
function replyTo(): string | undefined {
  const value = process.env.MAIL_REPLY_TO?.trim();
  return value || undefined;
}

/** A rough guard so a typo in a player's address cannot break a whole batch. */
export function looksLikeEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(trimmed);
}

/**
 * Sends one message, or records that it would have been sent. Never throws:
 * a failed send comes back as a FAILED result so one bad address cannot stop
 * the rest of a field being invited.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!looksLikeEmail(message.to)) {
    return { status: "FAILED", providerId: null, error: "That address does not look like an email" };
  }
  if (!mailConfigured()) return { status: "DRY_RUN", providerId: null };

  try {
    const response = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(replyTo() ? { reply_to: replyTo() } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) {
      return { status: "FAILED", providerId: null, error: data.message ?? `Mail provider returned ${response.status}` };
    }
    return { status: "SENT", providerId: data.id ?? null };
  } catch (error) {
    return {
      status: "FAILED",
      providerId: null,
      error: error instanceof Error ? error.message : "Could not reach the mail provider",
    };
  }
}
