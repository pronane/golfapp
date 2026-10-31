import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { societies } from "@/db/schema";
import { json, parseJson, requireUser, route } from "@/lib/http";
import { getMembership, getSocietyById, listSocietyEvents, listSocietyMembers, requireSocietyRole } from "@/lib/societies";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Society detail: roster and fixtures. Membership is required to read it. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const society = await getSocietyById(id);
  if (!society) return json({ error: "Society not found" }, { status: 404 });
  const membership = await getMembership(id, user);
  if (!membership && !user.isSiteAdmin) return json({ error: "Society not found" }, { status: 404 });
  const [members, fixtures] = await Promise.all([listSocietyMembers(id), listSocietyEvents(id)]);
  return json({ society, members, fixtures, role: membership?.role ?? "OWNER" });
});

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(400).nullable().optional(),
  homeClub: z.string().max(120).nullable().optional(),
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireSocietyRole(user, id);
  const body = validate(updateSchema, await parseJson(request));
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) set.name = body.name.trim();
  if (body.description !== undefined) set.description = body.description?.trim() || null;
  if (body.homeClub !== undefined) set.homeClub = body.homeClub?.trim() || null;
  if (Object.keys(set).length > 0) await db.update(societies).set(set).where(eq(societies.id, id));
  return json({ ok: true });
});
