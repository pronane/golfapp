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

## Not built (and not pretended)

- No open/click tracking, no bounce handling, no unsubscribe list.
- No reminder or "your group is next" scheduling - a cron-less host has no
  scheduler, and SSE covers the live case.
- Attachments, HTML templates and per-society sender addresses are not there;
  the body is plain text on purpose, because it renders on a five-year-old
  phone in a buggy and never lands in a spam folder for looking like a blast.
