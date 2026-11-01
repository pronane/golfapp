import { json, route } from "@/lib/http";
import { lookupByGolfEnglandId, resolveHandicapProvider, searchMockDirectory } from "@/lib/golfengland";

export const dynamic = "force-dynamic";

/**
 * Directory / handicap lookup.
 *
 * `?societyId=` makes the lookup use that club's configured source (its own WHS
 * credentials, its CDH endpoint, or nothing at all); without one it uses the
 * deployment default. The provider is echoed back so the UI can explain itself.
 */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const id = url.searchParams.get("id");
  const societyId = url.searchParams.get("societyId");
  const provider = await resolveHandicapProvider({ societyId });

  const summary = { source: provider.source, label: provider.label, ready: provider.ready, detail: provider.detail };

  if (id) {
    if (provider.source === "MANUAL") {
      return json({ provider: summary, player: null, notice: "This club types handicaps in by hand." });
    }
    if (!provider.ready) {
      return json({ provider: summary, player: null, notice: provider.detail }, { status: 409 });
    }
    const player = await lookupByGolfEnglandId(id, { societyId });
    return json({ provider: summary, player, notice: player ? null : "No golfer found for that ID." });
  }

  // Free-text search only ever reads the local directory: looking people up by
  // name on a national database would be a privacy problem, and the API does
  // not offer it anyway.
  return json({ provider: summary, players: searchMockDirectory(q) });
});
