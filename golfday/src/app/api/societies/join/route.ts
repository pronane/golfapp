import { z } from "zod";
import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { addSocietyMember, getMembership, getSocietyByJoinCode } from "@/lib/societies";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

const joinSchema = z.object({ code: z.string().min(4, "Enter the society code").max(12) });

/** Join a society with its code, like entering a golf day with a join code. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = validate(joinSchema, await parseJson(request));
  if (!user.playerId) throw new ApiError(409, "Finish your player profile first", "no_player");
  const society = await getSocietyByJoinCode(body.code);
  if (!society) throw new ApiError(404, "No society uses that code", "not_found");
  const already = await getMembership(society.id, user);
  await addSocietyMember(society.id, user.playerId);
  return json({ society: { id: society.id, slug: society.slug, name: society.name }, already: Boolean(already) });
});
