import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, requireUser, route } from "@/lib/http";
import { getEventById, registerPlayer } from "@/lib/events";
import { registerPlayerSchema, validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Register a player. Event admins can add anybody; a player can enter themselves. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const body = validate(registerPlayerSchema, await parseJson(request));
  const access = await getEventAccess(id, user);
  const isSelf = user.playerId === body.playerId;
  if (!access?.isAdmin && !isSelf) {
    throw new ApiError(403, "Only event admins can register other players", "forbidden");
  }
  const event = await getEventById(id);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (isSelf && !access && !["OPEN", "IN_PROGRESS"].includes(event.status)) {
    throw new ApiError(409, "This event is not open for entries", "event_closed");
  }
  const result = await registerPlayer({
    eventId: id,
    playerId: body.playerId,
    groupId: body.groupId ?? null,
    tee: body.tee,
    status: body.status,
    force: body.force && Boolean(access?.isAdmin),
  });
  return json(result, { status: 201 });
});

/** Leave an event (players can withdraw themselves, admins can remove anybody). */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Sign in first", "unauthenticated");
  return json({ event: await getEventById(id) });
});
