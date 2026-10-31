import { getEventById, getRevision } from "@/lib/events";
import { buildLeaderboard, canViewEventBoard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-Sent Events feed for the live leaderboard.
 * Every write to a card bumps a revision counter; this stream polls that single
 * integer (cheap, works on serverless) and pushes the full board when it moves.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  // Same rule as the JSON board: private golf days only stream to the people
  // who run them, and answer 404 so the id is not confirmed.
  const event = await getEventById(id);
  if (!event || !(await canViewEventBoard(event))) {
    return Response.json({ error: "Event not found" }, { status: 404 });
  }
  const lite = new URL(request.url).searchParams.get("lite") === "1";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastRevision = -1;
      let closed = false;

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };

      const tick = async () => {
        if (closed) return;
        try {
          const revision = await getRevision(id);
          if (revision !== lastRevision) {
            lastRevision = revision;
            const board = await buildLeaderboard(id);
            if (!board) {
              send("error", { message: "Event not found" });
              close();
              return;
            }
            const payload = lite
              ? { ...board, standings: board.standings.filter((s) => s.thru > 0).slice(0, 5) }
              : board;
            send("leaderboard", payload);
          } else {
            controller.enqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
          }
        } catch (err) {
          console.error("[sse]", err);
          send("error", { message: "Live updates paused" });
        }
      };

      const timer = setInterval(tick, 2000);
      request.signal.addEventListener("abort", close);
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
