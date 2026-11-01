/**
 * Sealing for third-party credentials at rest.
 *
 * A society can store its own WHS/CDH API secret, which is far too sensitive to
 * sit in the database as plaintext: a database dump, a Turso snapshot or a
 * backup would leak a club's handicap credentials. Secrets are therefore sealed
 * with AES-256-GCM using a key derived from `AUTH_SECRET` (already required in
 * production, and never stored next to the data).
 *
 * The output is `v1.<iv>.<tag>.<ciphertext>` (base64url), so a future key
 * rotation can be detected and re-sealed rather than silently mis-decrypted.
 *
 * Rotating `AUTH_SECRET` therefore invalidates stored integration secrets (and
 * existing sessions). That is deliberate: an owner re-enters the key, and the
 * society falls back to manual entry until they do.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      "AUTH_SECRET is required to store integration credentials. Set it (openssl rand -base64 48) before saving an API key.",
    );
  }
  // Derive a dedicated 32-byte key so the raw session secret is never used as
  // an encryption key directly.
  return createHash("sha256").update(`golfday:integration-secrets:${secret}`).digest();
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Opens a sealed value. Returns null (rather than throwing) when the value was
 * sealed with a different key - e.g. after a secret rotation - so a stale
 * credential degrades to "not configured" instead of breaking the page.
 */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const [, iv, tag, ciphertext] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Never echo a credential back to a client - show its shape instead. */
export function maskSecret(sealed: string | null | undefined): string | null {
  const plaintext = openSecret(sealed);
  if (!plaintext) return null;
  if (plaintext.length <= 4) return "••••";
  return `${plaintext.slice(0, 2)}••••${plaintext.slice(-2)} (${plaintext.length} chars)`;
}
