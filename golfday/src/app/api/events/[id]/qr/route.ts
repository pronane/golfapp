import qrcode from "qrcode-generator";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { groups } from "@/db/schema";
import { ApiError, requireEventAccess, requireUser, route } from "@/lib/http";
import { appOrigin } from "@/lib/oauth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * SVG QR code for a group's scoring link - the thing that gets printed on a
 * card and stuck to the buggy. Admin-only, because the group token is the
 * password for that card: handing the QR to a stranger hands over the card.
 *
 *   /api/events/<id>/qr?group=<groupId>&cell=8
 */
export const GET = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can print cards", "forbidden");

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group");
  if (!groupId) throw new ApiError(400, "Say which group", "group_required");
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group || group.eventId !== id) throw new ApiError(404, "Group not found", "not_found");

  const target = `${appOrigin(request)}/score/${group.token}`;
  const cell = Math.min(16, Math.max(2, Number(url.searchParams.get("cell") ?? 6) || 6));
  const qr = qrcode(0, "M");
  qr.addData(target);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // The token never changes, so a printed card and the image stay in step.
      "Cache-Control": "private, max-age=86400",
    },
  });
});
