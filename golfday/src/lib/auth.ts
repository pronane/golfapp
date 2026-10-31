import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players, users } from "@/db/schema";
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
