import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, getEventBundle, getEventHoles } from "@/lib/events";
import { cleanSettings, getGameSettings, listPairs, saveGameSettings } from "@/lib/games";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Game settings + pairs for the organiser console. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireEventAccess(id, user);
  const [settings, pairs] = await Promise.all([getGameSettings(id), listPairs(id)]);
  return json({ settings, pairs });
});

export const PUT = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can change the games", "forbidden");
  const body = await parseJson<Record<string, unknown>>(request);
  const holes = await getEventHoles(id);
  const settings = cleanSettings(body, holes.length || 18);
  // Match play sides must be players actually entered in this event.
  const bundle = await getEventBundle(id);
  const entered = new Set(
    (bundle?.registrations ?? []).filter((r) => r.registration.status === "REGISTERED").map((r) => r.player.id),
  );
  const bad = settings.matches.find((m) => [...m.sideA, ...m.sideB].some((p) => !entered.has(p)));
  if (bad) throw new ApiError(400, `${bad.name} includes someone who isn't entered`, "bad_match");
  await saveGameSettings(id, settings);
  const revision = await bumpRevision(id);
  return json({ settings, revision });
});
