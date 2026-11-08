// Certilia's claims about a user, shared by sign-in and the profile photo. Certilia puts all of them in the ID token
// (its userinfo endpoint answered 400 to real access tokens, so it isn't used).
import { isValidOib } from "./members";

/** Claims of an ID token Better Auth has verified at sign-in (signature, issuer, audience, nonce), or stored after it. */
export const certiliaClaims = (idToken: string | null | undefined): Record<string, unknown> =>
  idToken ? JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString() || "{}") : {};

/** The verified OIB, which Certilia sends as the subject (`sub`); null for anyone without a valid one. */
export function certiliaOib(claims: Record<string, unknown>): string | null {
  const oib = String(claims.sub ?? "");
  return isValidOib(oib) ? oib : null;
}
