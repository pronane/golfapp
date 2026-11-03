import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, route } from "@/lib/http";
import { duplicateEvent } from "@/lib/events";
import { z } from "zod";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** YYYY-MM-DD. Defaults to a week after the source event. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-04-12").optional(),
  name: z.string().trim().min(3).max(120).optional(),
  copyField: z.boolean().optional(),
  copyGroups: z.boolean().optional(),
});

/**
 * "Run it again": a new golf day with the same course, card, format, games and
 * (optionally) the same field and four-balls. The caller becomes its owner.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Sign in first", "unauthorized");
  const access = await getEventAccess(id, user);
  if (!access?.isAdmin) throw new ApiError(403, "Only the organisers of this golf day can repeat it", "forbidden");

  const body = validate(schema, await parseJson(request).catch(() => ({})));
  const copyGroups = Boolean(body.copyGroups);
  const created = await duplicateEvent({
    sourceId: id,
    createdBy: user.id,
    date: body.date,
    name: body.name,
    copyField: Boolean(body.copyField) || copyGroups,
    copyGroups,
  });
  return json({ event: created, skipped: created.skipped }, { status: 201 });
});
