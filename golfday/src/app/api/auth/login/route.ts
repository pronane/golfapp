import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth";
import { ApiError, json, parseJson, route } from "@/lib/http";
import { setSessionCookie, signSession } from "@/lib/session";
import { loginSchema, validate } from "@/lib/validate";

export const POST = route(async (request: Request) => {
  const body = validate(loginSchema, await parseJson(request));
  const email = body.email.toLowerCase().trim();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, "Email or password is incorrect", "invalid_credentials");
  }
  await setSessionCookie(await signSession({ uid: user.id, email: user.email }));
  return json({ ok: true, userId: user.id });
});
