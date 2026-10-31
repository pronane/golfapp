import { json, route } from "@/lib/http";
import { getGroupScoreboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** Public-ish read of a tee group and its card (used by the group scoring page). */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const board = await getGroupScoreboard(token);
  if (!board) return json({ error: "That scoring link is not valid" }, { status: 404 });
  return json(board, { headers: { "Cache-Control": "no-store" } });
});
