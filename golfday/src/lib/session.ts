import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE = "golfday_session";
const DEV_SECRET = "golfday-dev-secret-change-me-in-production";

/**
 * The dev fallback is committed to the repo, so with it anyone can mint a valid
 * session JWT for any user id. Refuse to sign or verify with it in production.
 * Resolved lazily so `next build` doesn't need the variable.
 */
function secretKey(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 32) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set to 32+ characters in production.");
  }
  return new TextEncoder().encode(value || DEV_SECRET);
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
