# Invitations and email

GolfDay never requires a mail account to run a golf day. Without one, the
organiser's invitations are written, recorded and readable in the console - they
just are not delivered by the app. Set two environment variables and the same
messages start going out.

## What gets sent

Every player in the field gets one message containing:

- the golf day, the course and the date,
- **their tee group and tee time** (`Group 2, teeing off at 09:20`),
- **their group's scorecard link** - the no-login link their four-ball uses,
- the live leaderboard link,
- the event's join code.

Players with no address on file are listed in the result rather than silently
skipped, and players with an account fall back to the address they signed in
with.

## Turning delivery on

The transport is [Resend](https://resend.com) - one HTTP call, no SDK, chosen
because it does not need a resident worker (which a free host will not give you).

```bash
RESEND_API_KEY="re_..."                        # resend.com → API Keys
MAIL_FROM="GolfDay <golfday@yourdomain.com>"   # a domain you have verified at Resend
MAIL_REPLY_TO="organiser@yourdomain.com"       # optional
```

Restart the app. The Invites tab now says "Email the field" instead of "Write the
invitations", and each send is marked `sent` in the outbox.

### Any other provider

`src/lib/mailer.ts` is deliberately the only file that knows about a provider.
It exposes one function, `sendMail({ to, toName, subject, text })`, returning
`SENT | DRY_RUN | FAILED`. Point it at Postmark, SES, Mailgun or a club's SMTP
relay and nothing else changes.

## The outbox

Every message is a row in `mail_outbox`:

| column | meaning |
|---|---|
| `status` | `SENT`, `DRY_RUN` (no provider configured), `FAILED`, `QUEUED` |
| `provider_id` | the provider's message id, when it has one |
| `error` | why a send failed - one bad address never stops the batch |
| `body` | exactly the text that was (or would have been) sent |

`GET /api/events/{id}/invites` returns the last twenty rows plus whether mail is
configured, which is what the console renders. `POST` to the same URL sends the
batch; it is admin-only, because it cannot be recalled.

## When there is no email at all: WhatsApp

Most societies do not collect addresses and do not want to. The **Share on
WhatsApp** button on the live board and in the console is the fallback, and it is
deliberately the cheapest possible thing:

- It is a `https://wa.me/?text=...` deep link. **No WhatsApp Business account, no
  Meta app, no API key, no message template waiting for approval, no per-message
  fee.** Nothing talks to Meta's servers from ours.
- It opens the WhatsApp the person already has, with the line and the link
  written, and *that person presses send* - so the message comes from their own
  number, to a chat they choose. GolfDay never sees the recipient.
- On a phone, that is the WhatsApp app. On a laptop it is WhatsApp Web; if that
  browser has never paired a phone, WhatsApp shows a "get the app" page instead.
  That is why the button also has **Copy link** - the same sentence on the
  clipboard - and, where the browser offers a share sheet, **Other app...**.
- The text is built in the browser from the page's own address, so it is correct
  on a demo host, a club domain and a laptop on the clubhouse wifi.

There is no group messaging, no address book and no delivery receipt. If an
organiser needs one message to twenty people, that is what the email batch above
is for, and a WhatsApp group they created themselves.

## Not built (and not pretended)

- No open/click tracking, no bounce handling, no unsubscribe list.
- No reminder or "your group is next" scheduling - a cron-less host has no
  scheduler, and SSE covers the live case.
- Attachments, HTML templates and per-society sender addresses are not there;
  the body is plain text on purpose, because it renders on a five-year-old
  phone in a buggy and never lands in a spam folder for looking like a blast.
