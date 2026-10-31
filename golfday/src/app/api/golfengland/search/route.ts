import { json, route } from "@/lib/http";
import { golfEnglandMode, lookupByGolfEnglandId, searchMockDirectory } from "@/lib/golfengland";

export const dynamic = "force-dynamic";

/** Demo/Catalogue search for the Golf England directory. */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const id = url.searchParams.get("id");
  if (id) return json({ mode: golfEnglandMode(), player: await lookupByGolfEnglandId(id) });
  return json({ mode: golfEnglandMode(), players: searchMockDirectory(q) });
});
