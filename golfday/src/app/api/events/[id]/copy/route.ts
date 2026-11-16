import { copyEvent } from "@/lib/events";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { copyEventSchema, validate } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can copy the event", "forbidden");
  const body = validate(copyEventSchema, await parseJson(request));
  const copied = await copyEvent({ eventId: id, createdBy: user.id, ...body });
  return json({ event: copied }, { status: 201 });
});
