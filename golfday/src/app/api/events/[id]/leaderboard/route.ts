import { getEventById } from "@/lib/events";
import { json, route } from "@/lib/http";
import { boardVisibility, buildLeaderboard, canViewEventBoard, redactBoard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const event = await getEventById(id);
  // Private events answer 404 rather than 403: a 403 would confirm that the id
  // is real to somebody who is not meant to know the event exists.
  if (!event || !(await canViewEventBoard(event))) {
    return json({ error: "Event not found" }, { status: 404 });
  }
  const board = await buildLeaderboard(id);
  if (!board) return json({ error: "Event not found" }, { status: 404 });
  const visibility = await boardVisibility(board, id);
  const payload = visibility.visible ? board : redactBoard(board, visibility);
  return json(payload, { headers: { "Cache-Control": "no-store" } });
});
