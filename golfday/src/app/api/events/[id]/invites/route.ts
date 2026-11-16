import { ApiError, json, requireEventAccess, requireUser, route } from "@/lib/http";
import { appOrigin } from "@/lib/oauth";
import { mailConfigured } from "@/lib/mailer";
import { recentMail, sendInvites } from "@/lib/invites";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** What has been sent for this event so far, and whether mail is even set up. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireEventAccess(id, user);
  return json({ configured: mailConfigured(), messages: await recentMail(id) });
});

/**
 * Email the field their tee group and card link.
 *
 * Admin-only: this puts a message in nineteen inboxes and cannot be recalled.
 * With no mail provider configured the whole batch is recorded as a dry run and
 * the response says so, rather than pretending it went out.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can send invitations", "forbidden");
  const summary = await sendInvites(id, appOrigin(request));
  if (!summary) throw new ApiError(404, "Event not found", "not_found");
  return json(summary);
});
