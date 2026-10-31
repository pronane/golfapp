import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventAdmins, users } from "@/db/schema";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { newId } from "@/lib/ids";
import { z } from "zod";
import { validate } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  email: z.string().email("Use the email address they signed up with"),
  role: z.enum(["ADMIN", "SCORER"]).default("ADMIN"),
});

/** Requirement 4: assign an admin (or a scorer) to the whole golf day. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can add admins", "forbidden");
  const body = validate(schema, await parseJson(request));

  const [target] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
  if (!target) {
    throw new ApiError(404, "No account uses that email yet - ask them to sign up first", "user_not_found");
  }
  const [existing] = await db
    .select()
    .from(eventAdmins)
    .where(and(eq(eventAdmins.eventId, id), eq(eventAdmins.userId, target.id)))
    .limit(1);
  if (existing) throw new ApiError(409, "They are already an admin of this event", "already_admin");

  await db.insert(eventAdmins).values({ id: newId(), eventId: id, userId: target.id, role: body.role });
  return json({ ok: true, userId: target.id }, { status: 201 });
});
