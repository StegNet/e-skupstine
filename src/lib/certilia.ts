// Certilia's claims about a user, shared by sign-in and the profile photo.
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "certilia"]);

const TIMEOUT = AbortSignal.timeout.bind(AbortSignal, 10_000);

type Tokens = { accessToken?: string | null; idToken?: string | null };

/** Claims from the ID token, which Better Auth has verified at sign-in (signature, issuer, audience, nonce). */
const idTokenClaims = (idToken: string | null | undefined): Record<string, unknown> =>
  idToken ? JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString() || "{}") : {};

/** The ID token's claims, plus the userinfo endpoint's when the ID token has none of `wanted`.
 * The ID token comes first because Certilia's server refuses request headers over ~8 KB: an access token carrying
 * the photo is larger than that, so userinfo answers 400 to it (and accepts the token nowhere else). */
export async function certiliaClaims(tokens: Tokens, wanted: string[]): Promise<Record<string, unknown>> {
  const claims = idTokenClaims(tokens.idToken);
  const discoveryUrl = process.env.CERTILIA_DISCOVERY_URL;
  if (wanted.some((c) => claims[c]) || !discoveryUrl || !tokens.accessToken) return claims;

  const d = await fetch(discoveryUrl, { signal: TIMEOUT() });
  const endpoint = d.ok ? (await d.json())?.userinfo_endpoint : null;
  if (typeof endpoint !== "string") {
    logger.error("Certilia discovery document unusable", { status: d.status });
    return claims;
  }
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: TIMEOUT() });
  if (!res.ok) {
    logger.warn("Certilia userinfo request failed", { status: res.status, tokenBytes: tokens.accessToken.length });
    return claims;
  }
  const info = (await res.json()) as Record<string, unknown>;
  logger.debug("Certilia userinfo received", { claims: Object.keys(info).sort().join(",") });
  return { ...claims, ...info };
}
