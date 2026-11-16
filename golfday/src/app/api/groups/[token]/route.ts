import { json, route } from "@/lib/http";
import { getGroupScoreboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** Public-ish read of a tee group and its card (used by the group scoring page). */
export const GET = route(async (request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  // Which round's holes to show on a multi-round card (default: the first).
  const wanted = Number(new URL(request.url).searchParams.get("round") ?? "1");
  const round = Number.isFinite(wanted) && wanted >= 1 ? Math.min(4, Math.floor(wanted)) : 1;
  const board = await getGroupScoreboard(token, round);
  if (!board) return json({ error: "That scoring link is not valid" }, { status: 404 });
  return json(board, { headers: { "Cache-Control": "no-store" } });
});
