# Signing in

Two ways in: email + password (always on), and **Google, Apple or Facebook**
when a deployment configures them. Both land on the same session cookie and the
same player account.

```
browser ──▶ /api/auth/oauth/google/start ──▶ provider (state + PKCE in a signed cookie)
                    │
                    ▼
/browser ◀── /api/auth/oauth/google/callback ──▶ token exchange ──▶ ID token verified
                    │                                              (JWKS, issuer, audience, nonce)
                    ▼
              users.oauth_provider/oauth_subject ──▶ session cookie ──▶ next page
```

No auth library is involved: this is the OAuth 2.0 authorisation-code flow with
PKCE, and `jose` (already a dependency for sessions) verifies the ID token
against the provider's published keys. The state, the PKCE verifier and the
post-login destination live in a short-lived (10 minute) signed, HttpOnly cookie,
so there is no server-side flow store to run or expire.

## Turning a provider on

Each provider appears on `/login` and `/register` only when both its values are
set - a self-hosted install with no OAuth apps looks exactly as it did before.

```env
OAUTH_GOOGLE_ID="....apps.googleusercontent.com"
OAUTH_GOOGLE_SECRET="GOCSPX-..."

OAUTH_APPLE_ID="com.example.golfday.web"   # the Service ID, not the app bundle id
OAUTH_APPLE_SECRET="eyJ..."                # Apple's client secret: a signed JWT

OAUTH_FACEBOOK_ID="1234567890"
OAUTH_FACEBOOK_SECRET="..."

# The public origin used to build redirect URIs (required behind a proxy)
APP_URL="https://golfday.example.com"
```

Redirect URI to register with each provider (exact match, including scheme):

```
https://<your-host>/api/auth/oauth/google/callback
https://<your-host>/api/auth/oauth/apple/callback
https://<your-host>/api/auth/oauth/facebook/callback
```

Notes per provider:

* **Google** - a standard OIDC web client. `access_type=online` and
  `prompt=select_account` are sent so a shared clubhouse PC can switch accounts.
* **Apple** - needs a Service ID and a client secret that Apple makes you sign as
  a JWT (ES256, key id + team id in the header, renewed at most every 6 months).
  Apple returns the code as a **form POST**, which the callback route accepts;
  the name is only shared on the very first sign-in, so it is stored then.
* **Facebook** - no ID token, so the profile is read from `/me` with the access
  token. Facebook only returns an email it considers verified, and may return
  none at all (phone sign-ups), which is refused with a clear message.

## Which account does a social sign-in become?

In this order, in `src/lib/auth.ts`:

1. **Provider + subject already linked** -> that user. This is the normal case.
2. **Verified email matches an existing account** -> link it. The password login
   keeps working; nothing else changes.
   An *unverified* email is refused (`oauth_unverified_email`): matching accounts
   on an unverified address is how social-login account takeover happens.
3. **Nothing matches** -> a new user and player, with an unusable random password
   hash so the account cannot be entered by guessing.

A second provider claiming an email that is already linked to another one is
refused (`oauth_provider_conflict`) rather than silently swapping the link - an
attacker who controls a stale mailbox cannot take the account over that way.

Every failure lands back on `/login?error=<code>` with a readable sentence, never
a stack trace:

| Code | Meaning |
| --- | --- |
| `provider_unavailable` | that provider has no credentials on this server |
| `sign_in_cancelled` | the user said no at the provider |
| `sign_in_expired` | the state cookie is gone (10 minute window) |
| `sign_in_state_mismatch` | the `state` came back different from the cookie |
| `oauth_exchange_failed` | the provider rejected the code / client |
| `oauth_unverified_email` | no verified email was shared |
| `oauth_provider_conflict` | that email already signs in another way |

## Security notes

* PKCE (`S256`) on every provider that supports it, and `nonce` on every OIDC
  one, so an intercepted code is useless and a replayed ID token is refused.
* `safeNext()` only accepts same-site paths after sign-in, so the `next` (`?next=`)
  parameter cannot be used as an open redirect.
* The ID token is verified for signature (JWKS), issuer, audience and nonce;
  the client secret never leaves the server.
* Sessions are the same 30-day signed JWT as password sign-in (`AUTH_SECRET`), so
  rotating that secret signs everybody out of both flows at once.
* Social sign-in creates a *player*, never an admin: per-event and per-society
  roles are granted afterwards, exactly as for a password account.

## Tests

`tests/integrations.test.ts` covers the pieces that are easy to get wrong:

* the PKCE challenge against the RFC 7636 test vector
* `safeNext()` refusing `//evil.example` and absolute URLs
* first sign-in creating an account, the second reusing it
* linking by verified email, refusing unverified emails, refusing a second
  provider on an already-linked account
* providers staying hidden until their env vars exist, and the generated
  authorisation URL carrying PKCE + state
