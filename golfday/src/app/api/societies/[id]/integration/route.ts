import { z } from "zod";
import { getMembership, getSocietyById, getSocietyIntegration, requireSocietyRole, updateSocietyIntegration } from "@/lib/societies";
import { HANDICAP_SOURCES, lookupByGolfEnglandId, resolveHandicapProvider } from "@/lib/golfengland";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The society's handicap integration.
 *
 * Members can read it (so the club page can say where numbers come from);
 * owners and secretaries can change it. Credentials come back masked or as a
 * boolean - never in the clear.
 */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const society = await getSocietyById(id);
  if (!society) throw new ApiError(404, "Society not found", "not_found");
  const membership = await getMembership(id, user);
  if (!membership && !user.isSiteAdmin) throw new ApiError(404, "Society not found", "not_found");
  const [integration, provider] = await Promise.all([getSocietyIntegration(id), resolveHandicapProvider({ societyId: id })]);
  return json({
    integration,
    provider: { source: provider.source, label: provider.label, ready: provider.ready, detail: provider.detail, country: provider.country },
    sources: HANDICAP_SOURCES,
    canManage: Boolean(user.isSiteAdmin || membership?.role === "OWNER" || membership?.role === "SECRETARY"),
  });
});

const schema = z.object({
  source: z.enum(["MANUAL", "DIRECTORY", "WHS", "CDH", "GHIN", "GOLF_CANADA", "GOLF_AUSTRALIA"]).optional(),
  country: z.enum(["eng", "sco", "wal", "irl"]).optional(),
  apiBase: z.string().max(300).optional(),
  username: z.string().max(120).optional(),
  // Write-only. Empty string clears the stored credential.
  secret: z.string().max(2000).optional(),
  clientToken: z.string().max(4000).optional(),
});

export const PUT = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireSocietyRole(user, id);
  const body = validate(schema, await parseJson(request));

  if (body.apiBase && !/^https?:\/\//i.test(body.apiBase)) {
    throw new ApiError(400, "The API base must start with http:// or https://", "invalid_url");
  }
  if (body.source === "WHS" && body.apiBase && !/^https?:\/\//i.test(body.apiBase)) {
    throw new ApiError(400, "The WHS API base must be a URL", "invalid_url");
  }

  const integration = await updateSocietyIntegration(id, body);
  const provider = await resolveHandicapProvider({ societyId: id });
  return json({
    ok: true,
    integration,
    provider: { source: provider.source, label: provider.label, ready: provider.ready, detail: provider.detail, country: provider.country },
  });
});

const testSchema = z.object({ golferId: z.string().min(1).max(60) });

/**
 * "Test lookup" - runs a real lookup with the saved configuration and reports
 * exactly what the provider said. This is the difference between a settings
 * form and an integration: an owner can prove it works before a competition.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireSocietyRole(user, id);
  const body = validate(testSchema, await parseJson(request));
  const provider = await resolveHandicapProvider({ societyId: id });
  if (provider.source === "MANUAL") {
    return json({ ok: false, code: "manual_mode", detail: provider.detail, player: null });
  }
  try {
    const player = await lookupByGolfEnglandId(body.golferId, { societyId: id });
    return json({
      ok: Boolean(player),
      code: player ? "found" : "not_found",
      detail: player
        ? `Found ${player.name} - handicap ${player.handicapIndex} at ${player.homeClub || "an unlisted club"} (${player.source}).`
        : `No golfer with that ID on ${provider.label}.`,
      player,
      provider: { source: provider.source, label: provider.label, ready: provider.ready },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      // The HTTP status matters: a lookup that *cannot run* (not configured,
      // rejected credentials, a timeout) is not the same answer as "nobody by
      // that number", and must never be mistaken for one.
      return json(
        { ok: false, code: error.code, detail: error.message, player: null, provider: { source: provider.source, label: provider.label, ready: provider.ready } },
        { status: error.status },
      );
    }
    throw error;
  }
});
