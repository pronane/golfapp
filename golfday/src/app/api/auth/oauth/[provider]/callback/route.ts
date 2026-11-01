import { NextResponse } from "next/server";
import { signInWithOAuthIdentity } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { appOrigin, callbackUrl, exchangeCode, readStateCookie, requireProvider, resolveIdentity, safeNext } from "@/lib/oauth";
import { setSessionCookie, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

function back(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL(`${appOrigin(request)}/login`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/**
 * Finishes the social sign-in.
 *
 * Handles both a GET (Google, Facebook) and the form_post that Apple uses, so
 * the same route works for all three providers. Everything that can go wrong
 * lands back on /login with a readable reason rather than a stack trace.
 */
async function complete(request: Request, ctx: Ctx) {
  const { provider: providerId } = await ctx.params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (providerError) return back(request, { error: `sign_in_cancelled` });

  const saved = await readStateCookie();
  if (!saved || saved.provider !== providerId) {
    return back(request, { error: "sign_in_expired" });
  }
  // Constant-time-ish compare is unnecessary here: an attacker who can read the
  // cookie can already forge the whole flow.
  if (!state || state !== saved.state) return back(request, { error: "sign_in_state_mismatch" });
  if (!code) return back(request, { error: "sign_in_no_code" });

  try {
    const provider = requireProvider(providerId);
    const tokens = await exchangeCode(provider, {
      code,
      redirectUri: callbackUrl(request, provider.id),
      verifier: saved.verifier,
    });
    const identity = await resolveIdentity(provider, tokens, saved.nonce);
    const result = await signInWithOAuthIdentity(identity);
    await setSessionCookie(await signSession({ uid: result.userId, email: identity.email }));
    return NextResponse.redirect(new URL(safeNext(saved.next), appOrigin(request)));
  } catch (error) {
    if (error instanceof ApiError) {
      return back(request, { error: error.code, detail: error.message });
    }
    console.error("[oauth] callback failed", error);
    return back(request, { error: "sign_in_failed" });
  }
}

export async function GET(request: Request, ctx: Ctx) {
  return complete(request, ctx);
}

/** Apple posts the code back as a form. */
export async function POST(request: Request, ctx: Ctx) {
  const form = await request.formData().catch(() => null);
  const code = typeof form?.get("code") === "string" ? String(form.get("code")) : null;
  const state = typeof form?.get("state") === "string" ? String(form.get("state")) : null;
  if (!code || !state) return back(request, { error: "sign_in_no_code" });
  // Re-enter through the same logic with the values lifted into the query.
  const url = new URL(request.url);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return complete(new Request(url.toString(), { method: "GET", headers: request.headers }), ctx);
}
