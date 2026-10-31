import { z } from "zod";
import { json, parseJson, requireOrganiser, requireUser, route } from "@/lib/http";
import { createSeason, listAllSeasons, listSeasonsForSociety } from "@/lib/seasons";
import { requireSocietyRole } from "@/lib/societies";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Seasons are shareable: a club's order of merit can be linked from anywhere. */
export const GET = route(async (request: Request) => {
  const societyId = new URL(request.url).searchParams.get("societyId");
  const rows = societyId ? await listSeasonsForSociety(societyId) : await listAllSeasons();
  return json({ seasons: rows });
});

const createSchema = z
  .object({
    name: z.string().min(2, "Give the season a name").max(100),
    societyId: z.string().min(1).nullable().optional(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    scheme: z.enum(["POSITION", "STABLEFORD"]).default("POSITION"),
    bestOf: z.coerce.number().int().min(0).max(40).default(0),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: "The season has to end on or after it starts", path: ["endsOn"] });

/**
 * Start a season. With a society the society's owner/secretary can create it;
 * without one you need to be an organiser (site admin or an event admin), the
 * same rule as the course library.
 */
export const POST = route(async (request: Request) => {
  const body = validate(createSchema, await parseJson(request));
  if (body.societyId) {
    const user = await requireUser();
    await requireSocietyRole(user, body.societyId);
    const season = await createSeason({ ...body, createdBy: user.id });
    return json({ season }, { status: 201 });
  }
  const user = await requireOrganiser("run a season");
  const season = await createSeason({ ...body, createdBy: user.id });
  return json({ season }, { status: 201 });
});
