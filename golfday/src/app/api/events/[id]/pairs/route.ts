import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, getEventBundle } from "@/lib/events";
import { listPairs, replacePairs } from "@/lib/games";
import { autoPairs } from "@/lib/sidegames";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function adminOnly(id: string) {
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can set pairs", "forbidden");
}

/**
 * Set the 4BBB pairs. `{ "auto": true }` pairs each tee group in order (1+2,
 * 3+4); otherwise `{ "pairs": [{ "name", "playerIds": [a, b] }] }` sets them
 * explicitly. Every player must be registered and appear in one pair at most.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await adminOnly(id);
  const bundle = await getEventBundle(id);
  if (!bundle) throw new ApiError(404, "Event not found", "not_found");
  const registered = bundle.registrations.filter((r) => r.registration.status === "REGISTERED");
  const body = await parseJson<{ auto?: boolean; pairs?: { name?: unknown; playerIds?: unknown }[] }>(request);

  let pairs: { name: string; playerIds: [string, string] }[];
  if (body.auto) {
    pairs = autoPairs(
      bundle.groups.map((g) => ({
        id: g.id,
        name: g.name,
        playerIds: registered
          .filter((r) => r.registration.groupId === g.id)
          .sort((a, b) => a.registration.joinedAt.localeCompare(b.registration.joinedAt))
          .map((r) => r.player.id),
      })),
    );
    if (pairs.length === 0) throw new ApiError(409, "Put players into tee groups first, then auto-pair", "no_groups");
  } else {
    const ids = new Set(registered.map((r) => r.player.id));
    const used = new Set<string>();
    pairs = [];
    for (const raw of Array.isArray(body.pairs) ? body.pairs : []) {
      const playerIds = Array.isArray(raw.playerIds) ? raw.playerIds.filter((p): p is string => typeof p === "string") : [];
      const [a, b] = playerIds;
      if (playerIds.length !== 2 || a === b || !ids.has(a) || !ids.has(b)) {
        throw new ApiError(400, "Each pair needs two different registered players", "bad_pair");
      }
      if (used.has(a) || used.has(b)) throw new ApiError(400, "A player can only be in one pair", "bad_pair");
      used.add(a);
      used.add(b);
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Pair ${pairs.length + 1}`;
      pairs.push({ name, playerIds: [a, b] });
    }
  }
  await replacePairs(id, pairs);
  const revision = await bumpRevision(id);
  return json({ pairs: await listPairs(id), revision });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await adminOnly(id);
  await replacePairs(id, []);
  const revision = await bumpRevision(id);
  return json({ ok: true, revision });
});
