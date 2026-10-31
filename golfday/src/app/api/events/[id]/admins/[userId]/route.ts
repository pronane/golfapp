import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventAdmins } from "@/db/schema";
import { ApiError, json, requireEventAccess, requireUser, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string; userId: string }> };

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id, userId } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can remove admins", "forbidden");
  const [row] = await db
    .select()
    .from(eventAdmins)
    .where(and(eq(eventAdmins.eventId, id), eq(eventAdmins.userId, userId)))
    .limit(1);
  if (!row) throw new ApiError(404, "Not an admin of this event", "not_found");
  if (row.role === "OWNER") throw new ApiError(409, "The event owner cannot be removed", "owner_protected");
  await db.delete(eventAdmins).where(eq(eventAdmins.id, row.id));
  return json({ ok: true });
});
