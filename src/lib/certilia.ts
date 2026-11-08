// Certilia's userinfo endpoint (from its discovery document), shared by sign-in and the profile photo.
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "certilia"]);

const TIMEOUT = AbortSignal.timeout.bind(AbortSignal, 10_000);

export async function certiliaUserInfo(accessToken: string | null | undefined) {
  const discoveryUrl = process.env.CERTILIA_DISCOVERY_URL;
  if (!discoveryUrl || !accessToken) return null;
  const d = await fetch(discoveryUrl, { signal: TIMEOUT() });
  const endpoint = d.ok ? (await d.json())?.userinfo_endpoint : null;
  if (typeof endpoint !== "string") {
    logger.error("Certilia discovery document unusable", { status: d.status });
    return null;
  }
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` }, signal: TIMEOUT() });
  if (!res.ok) {
    logger.warn("Certilia userinfo request failed", { status: res.status });
    return null;
  }
  const info = (await res.json()) as Record<string, unknown>;
  logger.debug("Certilia userinfo received", { claims: Object.keys(info).sort().join(",") });
  return { endpoint, info };
}
