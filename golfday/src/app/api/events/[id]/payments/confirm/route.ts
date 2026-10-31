import { NextResponse } from "next/server";
import { bumpRevision, getEventById } from "@/lib/events";
import { confirmCheckout } from "@/lib/payments";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Stripe Checkout's success_url lands here; we verify with Stripe, then go back to the event. */
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const event = await getEventById(id);
  const back = new URL(event ? `/events/${event.slug}` : "/events", process.env.APP_URL ?? url.origin);
  let paid = false;
  try {
    paid = await confirmCheckout(id, url.searchParams.get("session_id") ?? "");
    if (paid) await bumpRevision(id);
  } catch (err) {
    console.error("[payments] confirm failed", err);
  }
  back.searchParams.set("payment", paid ? "paid" : "pending");
  return NextResponse.redirect(back, 303);
}
