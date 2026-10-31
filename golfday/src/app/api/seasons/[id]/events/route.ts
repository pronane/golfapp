import { z } from "zod";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import {
  attachEventToSeason,
  detachEventFromSeason,
  getSeasonById,
  listSeasonFixtures,
  requireSeasonManager,
} from "@/lib/seasons";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const linkSchema = z.object({ eventId: z.string().min(1) });

async function context(request: Request, id: string) {
  const user = await requireUser();
  const season = await getSeasonById(id);
  if (!season) throw new ApiError(404, "Season not found", "not_found");
  await requireSeasonManager(user, season);
  const body = validate(linkSchema, await parseJson(request));
  const access = await requireEventAccess(body.eventId, user);
  if (!access.isAdmin) throw new ApiError(403, "You need to run that golf day to count it", "forbidden");
  return { season, body };
}

/** Count one of your golf days in the season. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { body } = await context(request, id);
  await attachEventToSeason(id, body.eventId);
  return json({ ok: true, fixtures: await listSeasonFixtures(id) });
});

export const DELETE = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { body } = await context(request, id);
  await detachEventFromSeason(id, body.eventId);
  return json({ ok: true, fixtures: await listSeasonFixtures(id) });
});
