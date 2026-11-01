/**
 * Sign in with Google, Apple or Facebook.
 *
 * No auth library: this is the OAuth 2.0 authorisation-code flow with PKCE,
 * which is what all three providers support, and `jose` (already a dependency)
 * verifies the OpenID Connect ID token against the provider's published keys.
 * Nothing about the flow depends on a session store: the state, the PKCE
 * verifier and the post-login destination ride in a short-lived signed cookie.
 *
 * Providers are opt-in. A provider appears on the sign-in page only when its
 * client id and secret are set, so a self-hosted install with no OAuth apps
 * looks and behaves exactly as before.
 */
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify, SignJWT, jwtVerify as verifyJwt } from "jose";
import { ApiError } from "./http";

export type OAuthProviderId = "google" | "apple" | "facebook";

export type OAuthProvider = {
  id: OAuthProviderId;
  label: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** OIDC providers publish a JWKS and an issuer; Facebook does not. */
  jwksUrl?: string;
  issuer?: string;
  userInfoUrl?: string;
  /** Apple wants a form-encoded POST and has no email in the id_token by default. */
  tokenAuth: "client_secret_post" | "client_secret_basic";
  extraAuthorizeParams?: Record<string, string>;
};

const DEFINITIONS: Record<OAuthProviderId, Omit<OAuthProvider, "clientId" | "clientSecret">> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: "https://accounts.google.com",
    scopes: ["openid", "email", "profile"],
    tokenAuth: "client_secret_post",
    extraAuthorizeParams: { access_type: "online", prompt: "select_account" },
  },
  apple: {
    id: "apple",
    label: "Apple",
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuer: "https://appleid.apple.com",
    scopes: ["name", "email"],
    tokenAuth: "client_secret_post",
    extraAuthorizeParams: { response_mode: "form_post" },
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email",
    scopes: ["email", "public_profile"],
    tokenAuth: "client_secret_post",
  },
};

function envKey(id: OAuthProviderId, suffix: "ID" | "SECRET"): string {
  return `OAUTH_${id.toUpperCase()}_${suffix}`;
}

/** The provider's configuration, or null when it is not set up. */
export function getProvider(id: string): OAuthProvider | null {
  if (!(id in DEFINITIONS)) return null;
  const definition = DEFINITIONS[id as OAuthProviderId];
  const clientId = process.env[envKey(definition.id, "ID")]?.trim();
  const clientSecret = process.env[envKey(definition.id, "SECRET")]?.trim();
  if (!clientId || !clientSecret) return null;
  return { ...definition, clientId, clientSecret };
}

export function configuredProviders(): { id: OAuthProviderId; label: string }[] {
  return (Object.keys(DEFINITIONS) as OAuthProviderId[])
    .map((id) => getProvider(id))
    .filter((provider): provider is OAuthProvider => Boolean(provider))
    .map((provider) => ({ id: provider.id, label: provider.label }));
}

export function requireProvider(id: string): OAuthProvider {
  const provider = getProvider(id);
  if (!provider) {
    throw new ApiError(404, "That sign-in provider is not enabled", "provider_disabled");
  }
  return provider;
}

/**
 * The absolute URL the provider should send the browser back to. Registered in
 * the provider console, so a wrong value is a hard error rather than a redirect
 * that never arrives; `APP_URL` is the override for deployments behind a proxy.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function callbackUrl(request: Request, providerId: string): string {
  return `${appOrigin(request)}/api/auth/oauth/${providerId}/callback`;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  // RFC 7636: BASE64URL(SHA256(verifier)), no padding.
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export type OAuthState = {
  provider: OAuthProviderId;
  state: string;
  verifier: string;
  next: string;
  nonce: string;
};

const STATE_COOKIE = "golfday_oauth";
const STATE_TTL_SECONDS = 600;

function stateKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new ApiError(500, "AUTH_SECRET is not configured", "server_misconfigured");
  return new TextEncoder().encode(secret);
}

export async function writeStateCookie(payload: OAuthState): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(stateKey());
  const jar = await cookies();
  jar.set(STATE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
}

export async function readStateCookie(): Promise<OAuthState | null> {
  const jar = await cookies();
  const token = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await verifyJwt(token, stateKey());
    if (typeof payload.state !== "string" || typeof payload.verifier !== "string") return null;
    return {
      provider: payload.provider as OAuthProviderId,
      state: payload.state,
      verifier: payload.verifier,
      next: typeof payload.next === "string" ? payload.next : "/dashboard",
      nonce: typeof payload.nonce === "string" ? payload.nonce : "",
    };
  } catch {
    return null;
  }
}

/** Only same-site paths: an open redirect after login would be a phishing gift. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export function authorizationUrl(
  provider: OAuthProvider,
  options: { redirectUri: string; state: string; challenge: string; nonce: string },
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", options.state);
  if (provider.id !== "facebook") {
    url.searchParams.set("code_challenge", options.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("nonce", options.nonce);
  }
  for (const [key, value] of Object.entries(provider.extraAuthorizeParams ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

export type OAuthIdentity = {
  provider: OAuthProviderId;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(
  provider: OAuthProvider,
  options: { code: string; redirectUri: string; verifier: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: provider.clientId,
  });
  if (provider.tokenAuth === "client_secret_post") body.set("client_secret", provider.clientSecret);
  if (provider.id !== "facebook") body.set("code_verifier", options.verifier);

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || data.error) {
    throw new ApiError(
      502,
      `The ${provider.label} sign-in was rejected${data.error_description ? `: ${data.error_description}` : ""}`,
      "oauth_exchange_failed",
    );
  }
  return data;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verifies the ID token and returns a normalised identity. */
export async function identityFromIdToken(
  provider: OAuthProvider,
  idToken: string,
  expectedNonce: string,
): Promise<OAuthIdentity> {
  if (!provider.jwksUrl) throw new ApiError(500, "Provider has no JWKS", "oauth_misconfigured");
  let jwks = jwksCache.get(provider.jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(provider.jwksUrl));
    jwksCache.set(provider.jwksUrl, jwks);
  }
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: provider.issuer,
    audience: provider.clientId,
  });
  if (expectedNonce && payload.nonce && payload.nonce !== expectedNonce) {
    throw new ApiError(401, "That sign-in token was not meant for this browser", "oauth_nonce_mismatch");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject) throw new ApiError(401, "The provider did not identify the account", "oauth_no_subject");
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  const name =
    (typeof payload.name === "string" && payload.name) ||
    [payload.given_name, payload.family_name].filter((part): part is string => typeof part === "string").join(" ") ||
    email.split("@")[0];
  return { provider: provider.id, subject, email, emailVerified, name };
}

/** Facebook has no ID token: read the profile with the access token instead. */
export async function identityFromUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthIdentity> {
  if (!provider.userInfoUrl) throw new ApiError(500, "Provider has no userinfo endpoint", "oauth_misconfigured");
  const url = new URL(provider.userInfoUrl);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ApiError(502, `The ${provider.label} profile lookup failed`, "oauth_userinfo_failed");
  const data = (await response.json().catch(() => ({}))) as { id?: string; name?: string; email?: string };
  if (!data.id) throw new ApiError(401, "The provider did not identify the account", "oauth_no_subject");
  const email = (data.email ?? "").trim().toLowerCase();
  return {
    provider: provider.id,
    subject: String(data.id),
    email,
    // Facebook only returns an address it considers verified, but it may omit
    // it entirely when the user signed up by phone - handled by the caller.
    emailVerified: Boolean(email),
    name: data.name?.trim() || email.split("@")[0] || "Golfer",
  };
}

export async function resolveIdentity(
  provider: OAuthProvider,
  tokens: TokenResponse,
  nonce: string,
): Promise<OAuthIdentity> {
  if (provider.userInfoUrl) {
    if (!tokens.access_token) throw new ApiError(502, "No access token returned", "oauth_exchange_failed");
    return identityFromUserInfo(provider, tokens.access_token);
  }
  if (!tokens.id_token) throw new ApiError(502, "No ID token returned", "oauth_exchange_failed");
  return identityFromIdToken(provider, tokens.id_token, nonce);
}
