import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { autoAllocateGroups } from "@/lib/events";
import { z } from "zod";
import { validate } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ size: z.coerce.number().int().min(1).max(8).default(4) });

/** Creates balanced tee groups (and tee times) for everybody registered. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can create groups", "forbidden");
  const body = validate(schema, await parseJson(request));
  const groups = await autoAllocateGroups(id, body.size);
  return json({ groups });
});
