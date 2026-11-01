import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players, users } from "@/db/schema";
import { randomUUID } from "node:crypto";
import { ApiError } from "./http";
import { newClaimCode, newId } from "./ids";
import { getSessionPayload } from "./session";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isSiteAdmin: boolean;
  playerId: string | null;
};

/** Loads the signed-in user (null when anonymous). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const payload = await getSessionPayload();
  if (!payload) return null;
  const [user] = await db.select().from(users).where(eq(users.id, payload.uid)).limit(1);
  if (!user) return null;
  const [player] = await db.select().from(players).where(eq(players.userId, user.id)).limit(1);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSiteAdmin: user.isSiteAdmin,
    playerId: player?.id ?? null,
  };
}

export async function createUserWithPlayer(input: {
  email: string;
  name: string;
  password: string;
  handicapIndex?: number;
  homeClub?: string;
  golfEnglandId?: string;
  isSiteAdmin?: boolean;
}) {
  const now = new Date().toISOString();
  const userId = newId();
  const playerId = newId();
  const passwordHash = await hashPassword(input.password);

  await db.insert(users).values({
    id: userId,
    email: input.email.toLowerCase().trim(),
    name: input.name.trim(),
    passwordHash,
    isSiteAdmin: input.isSiteAdmin ?? false,
  });

  await db.insert(players).values({
    id: playerId,
    userId,
    name: input.name.trim(),
    email: input.email.toLowerCase().trim(),
    handicapIndex: input.handicapIndex ?? 0,
    homeClub: input.homeClub ?? null,
    golfEnglandId: input.golfEnglandId ?? null,
    claimCode: newClaimCode(),
    handicapSource: input.golfEnglandId ? "GOLF_ENGLAND" : "MANUAL",
    handicapUpdatedAt: now,
  });

  return { userId, playerId };
}

/**
 * Sign in (or sign up) with a social identity.
 *
 * Three cases, in this order:
 *   1. this provider + subject has signed in before -> that user
 *   2. the verified email already has an account  -> link it, keep the password
 *      login working, and never let one provider silently take over another
 *   3. nobody -> a new user and player, with an unusable password hash so the
 *      account cannot be entered by guessing (they can set one later)
 *
 * An identity without a verified email is refused: matching accounts by an
 * unverified address is how social-login account-takeover bugs happen.
 */
export async function signInWithOAuthIdentity(input: {
  provider: "google" | "apple" | "facebook";
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}) {
  const email = input.email.trim().toLowerCase();
  const [linked] = await db
    .select()
    .from(users)
    .where(and(eq(users.oauthProvider, input.provider), eq(users.oauthSubject, input.subject)))
    .limit(1);
  if (linked) {
    const [player] = await db.select().from(players).where(eq(players.userId, linked.id)).limit(1);
    return { userId: linked.id, playerId: player?.id ?? null, created: false, linked: true };
  }

  if (!email || !input.emailVerified) {
    throw new ApiError(
      409,
      `That ${input.provider} account did not share a verified email address, so it cannot be matched to a GolfDay account. Sign in with email and password instead.`,
      "oauth_unverified_email",
    );
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if (existing.oauthProvider && existing.oauthProvider !== input.provider) {
      throw new ApiError(
        409,
        `That email already signs in with ${existing.oauthProvider}. Use that, or sign in with your password and link this account from your profile.`,
        "oauth_provider_conflict",
      );
    }
    await db
      .update(users)
      .set({ oauthProvider: input.provider, oauthSubject: input.subject })
      .where(eq(users.id, existing.id));
    const [player] = await db.select().from(players).where(eq(players.userId, existing.id)).limit(1);
    return { userId: existing.id, playerId: player?.id ?? null, created: false, linked: true };
  }

  // A brand-new account: an unguessable password hash, no way in without OAuth.
  const { userId, playerId } = await createUserWithPlayer({
    email,
    name: input.name,
    password: randomUUID() + randomUUID(),
  });
  await db
    .update(users)
    .set({ oauthProvider: input.provider, oauthSubject: input.subject })
    .where(eq(users.id, userId));
  return { userId, playerId, created: true, linked: false };
}
