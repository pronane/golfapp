import { z } from "zod";
import { json, parseJson, requireUser, route } from "@/lib/http";
import {
  deleteSeason,
  getOrderOfMerit,
  getSeasonById,
  listSeasonFixtures,
  requireSeasonManager,
  updateSeason,
} from "@/lib/seasons";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Season + fixtures + table. Public: this is the noticeboard. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const season = await getSeasonById(id);
  if (!season) return json({ error: "Season not found" }, { status: 404 });
  const [fixtures, table] = await Promise.all([listSeasonFixtures(season.id), getOrderOfMerit(season)]);
  return json({ season, fixtures, table });
});

const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheme: z.enum(["POSITION", "STABLEFORD"]).optional(),
  bestOf: z.coerce.number().int().min(0).max(40).optional(),
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const season = await getSeasonById(id);
  if (!season) return json({ error: "Season not found" }, { status: 404 });
  await requireSeasonManager(user, season);
  const body = validate(updateSchema, await parseJson(request));
  await updateSeason(id, body);
  const fresh = await getSeasonById(id);
  return json({ season: fresh });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const season = await getSeasonById(id);
  if (!season) return json({ error: "Season not found" }, { status: 404 });
  await requireSeasonManager(user, season);
  await deleteSeason(id);
  return json({ ok: true });
});
