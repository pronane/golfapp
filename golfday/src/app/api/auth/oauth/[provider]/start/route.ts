import { NextResponse } from "next/server";
import { appOrigin, authorizationUrl, callbackUrl, createPkcePair, requireProvider, safeNext, writeStateCookie } from "@/lib/oauth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * Starts the social sign-in: mint state + PKCE, remember them in a short-lived
 * signed cookie, and send the browser to the provider.
 */
export async function GET(request: Request, ctx: Ctx) {
  const { provider: providerId } = await ctx.params;
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  try {
    const provider = requireProvider(providerId);
    const { verifier, challenge } = createPkcePair();
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    await writeStateCookie({ provider: provider.id, state, verifier, next, nonce });
    const target = authorizationUrl(provider, {
      redirectUri: callbackUrl(request, provider.id),
      state,
      challenge,
      nonce,
    });
    return NextResponse.redirect(target);
  } catch {
    // Provider not configured, or no AUTH_SECRET to sign the state cookie.
    return NextResponse.redirect(new URL(`${appOrigin(request)}/login?error=provider_unavailable`));
  }
}
