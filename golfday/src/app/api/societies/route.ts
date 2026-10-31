import { z } from "zod";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { createSociety, listSocietiesForPlayer } from "@/lib/societies";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** The societies the signed-in user belongs to. */
export const GET = route(async () => {
  const user = await requireUser();
  if (!user.playerId) return json({ societies: [] });
  return json({ societies: await listSocietiesForPlayer(user.playerId) });
});

const createSchema = z.object({
  name: z.string().min(2, "Give the society a name").max(100),
  description: z.string().max(400).optional(),
  homeClub: z.string().max(120).optional(),
});

/** Start a society - the founder becomes its owner and first member. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = validate(createSchema, await parseJson(request));
  if (!user.playerId) {
    throw new ApiError(409, "Finish setting up your player profile before starting a society", "no_player");
  }
  const society = await createSociety({
    name: body.name,
    description: body.description ?? null,
    homeClub: body.homeClub ?? null,
    createdBy: user.id,
    foundedByPlayerId: user.playerId,
  });
  return json({ society }, { status: 201 });
});
