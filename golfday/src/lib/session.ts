import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE = "golfday_session";
const DEV_SECRET = "golfday-dev-secret-change-me-in-production";

/**
 * Values that have been published in this repository (code, docs, .env.example,
 * blog posts). Anybody can read them, so a deployment using one of them can have
 * its session JWTs minted by a stranger. Length alone is not enough to catch
 * them - `change-me-to-a-long-random-string` is 33 characters.
 */
const KNOWN_PLACEHOLDERS = new Set(
  [
    DEV_SECRET,
    "change-me-to-a-long-random-string",
    "change-me",
    "changeme",
    "your-secret-here",
    "your-secret-key",
    "replace-me",
    "secret",
    "development",
    "supersecret",
  ].map((value) => value.toLowerCase()),
);

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/** True when the value is a published placeholder rather than a real secret. */
export function isPlaceholderSecret(value: string | undefined): boolean {
  if (!value) return true;
  const v = normalise(value);
  if (KNOWN_PLACEHOLDERS.has(v)) return true;
  // Catch the "please change me" family even when the wording varies.
  return /(change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|placeholder|example|dev[-_ ]?secret|please[-_ ]?change)/.test(v);
}

/**
 * Fails fast in production if the session secret is missing, too short, or a
 * value that is published in this repo. Called from `instrumentation.ts` at boot
 * and again lazily by every sign/verify, so a misconfigured deploy can never
 * start serving sessions signed with a known key.
 */
export function assertAuthSecret(): void {
  const value = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV !== "production") return;
  if (!value || value.trim().length < 32 || isPlaceholderSecret(value)) {
    throw new Error(
      "AUTH_SECRET is missing, shorter than 32 characters, or still a placeholder from .env.example. " +
        "Generate one with `openssl rand -base64 48` and set it in your hosting provider's environment.",
    );
  }
}

/**
 * Resolved lazily so `next build` doesn't need the variable.
 *
 * The length rule is a production rule only - a developer may use a short
 * local secret - but a *published* placeholder is never used as a key, even
 * locally: falling back to the known dev secret keeps one stable key per
 * machine instead of silently signing with a value anybody can read.
 */
function secretKey(): Uint8Array {
  const value = process.env.AUTH_SECRET?.trim();
  const usable =
    Boolean(value) &&
    !isPlaceholderSecret(value) &&
    (process.env.NODE_ENV !== "production" || (value as string).length >= 32);

  if (usable) return new TextEncoder().encode(value);

  if (process.env.NODE_ENV === "production") {
    // Throws with the single, actionable message used at boot too...
    assertAuthSecret();
    // ...and never falls through to the committed dev secret if that changes.
    throw new Error("AUTH_SECRET is not configured");
  }
  return new TextEncoder().encode(DEV_SECRET);
}

export type SessionPayload = { uid: string; email: string };

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

export async function readSessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.uid !== "string" || typeof payload.email !== "string") return null;
    return { uid: payload.uid, email: payload.email };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(COOKIE)?.value);
}
