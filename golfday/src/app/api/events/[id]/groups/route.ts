import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { groups } from "@/db/schema";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, createGroup, getEventGroups, getEventRegistrations } from "@/lib/events";
import { z } from "zod";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const createGroupSchema = z.object({
  name: z.string().max(40).optional(),
  teeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return json({ groups: await getEventGroups(id), registrations: await getEventRegistrations(id) });
});

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can manage groups", "forbidden");
  const body = validate(createGroupSchema, await parseJson(request));
  const group = await createGroup(id, body.name, body.teeTime);
  return json({ group }, { status: 201 });
});

const patchSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().max(40).optional(),
  teeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/** Rename a group / change tee time, or move a player into it. */
export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can manage groups", "forbidden");
  const body = validate(patchSchema, await parseJson(request));
  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.teeTime) updates.teeTime = body.teeTime;
  if (Object.keys(updates).length > 0) {
    await db.update(groups).set(updates).where(eq(groups.id, body.groupId));
  }
  await bumpRevision(id);
  return json({ ok: true });
});
