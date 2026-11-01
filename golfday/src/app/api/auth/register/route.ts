import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createUserWithPlayer } from "@/lib/auth";
import { ApiError, json, parseJson, route } from "@/lib/http";
import { signSession, setSessionCookie } from "@/lib/session";
import { registerSchema, validate } from "@/lib/validate";

export const POST = route(async (request: Request) => {
  const body = validate(registerSchema, await parseJson(request));
  const email = body.email.toLowerCase().trim();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new ApiError(409, "An account with that email already exists", "email_taken");

  const { userId } = await createUserWithPlayer({
    email,
    name: body.name,
    password: body.password,
    handicapIndex: body.handicapIndex ?? 0,
    golfEnglandId: body.golfEnglandId,
    homeClub: body.homeClub,
    handicapSource: body.handicapSource,
    handicapNote: body.handicapNote,
  });
  await setSessionCookie(await signSession({ uid: userId, email }));
  return json({ ok: true, userId });
});
