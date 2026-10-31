import { json, route } from "@/lib/http";
import { buildLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const board = await buildLeaderboard(id);
  if (!board) return json({ error: "Event not found" }, { status: 404 });
  return json(board, { headers: { "Cache-Control": "no-store" } });
});
