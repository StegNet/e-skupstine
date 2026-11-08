// Profile photos: the Certilia photo when the person shares it, otherwise their Gravatar, otherwise none (initials).
// The server fetches the image at sign-in and serves it from /api/avatar/<userId>, so browsers never contact
// Certilia or Gravatar and the page CSP stays 'self'.
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { certiliaClaims } from "./certilia";
import { db } from "./db";
import * as s from "./db/schema";
import { getLogger } from "@logtape/logtape";
import { errorMessage } from "./errors";

const logger = getLogger(["e-skupstina", "avatar"]);

const MAX_BYTES = 1_000_000;
/** Claims Certilia may use for the photo; its discovery document lists all of these. */
const PHOTO_CLAIMS = ["photo", "picture", "photourl", "thumbnail"];

export type Img = { contentType: string; data: Buffer };

/** Image type from the file's first bytes. Anything else (SVG, HTML…) is refused, so it can never run as a page. */
export function sniffImage(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(1, 4) === "PNG" && b[0] === 0x89) return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function asImage(data: Buffer): Img | null {
  const contentType = sniffImage(data);
  return contentType && data.length <= MAX_BYTES ? { contentType, data } : null;
}

/** A photo given inline in a claim: a data: URI or bare base64. */
export function inlinePhoto(value: string): Img | null {
  const v = value.trim();
  return asImage(Buffer.from(v.startsWith("data:") ? v.slice(v.indexOf(",") + 1) : v, "base64"));
}

async function download(url: string, headers?: HeadersInit): Promise<Img | null> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  const host = new URL(url).hostname;
  if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
    logger.debug("photo download: nothing usable", { host, status: res.status });
    return null;
  }
  const img = asImage(Buffer.from(await res.arrayBuffer()));
  if (!img) logger.warn("photo download refused: not a JPEG/PNG/GIF/WebP or too large", { host });
  return img;
}

async function certiliaPhoto(userId: string): Promise<Img | null> {
  const [acc] = await db
    .select({ accessToken: s.account.accessToken, idToken: s.account.idToken })
    .from(s.account)
    .where(and(eq(s.account.userId, userId), eq(s.account.providerId, "certilia")));
  if (!acc) return null;
  const info = await certiliaClaims(acc, PHOTO_CLAIMS);
  const claim = PHOTO_CLAIMS.find((c) => typeof info[c] === "string" && info[c]);
  const value = claim ? (info[claim] as string) : null;
  logger.debug("Certilia photo claim", { userId, claim: claim ?? "none", form: value ? (value.startsWith("https://") ? "url" : "inline") : null });
  if (!value) return null;
  if (!value.startsWith("https://")) {
    const img = inlinePhoto(value);
    if (!img) logger.warn("Certilia photo refused: not a JPEG/PNG/GIF/WebP or too large", { userId, claim });
    return img;
  }
  // The access token goes only to Certilia's own host, never to a URL elsewhere.
  const sameHost = new URL(value).host === new URL(process.env.CERTILIA_DISCOVERY_URL!).host;
  return download(value, sameHost && acc.accessToken ? { Authorization: `Bearer ${acc.accessToken}` } : undefined);
}

/** Gravatar by SHA-256 of the email; d=404 means "no Gravatar" instead of a default picture. */
export async function gravatar(email: string): Promise<Img | null> {
  if (!email || email.endsWith(".invalid")) return null;
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return download(`https://gravatar.com/avatar/${hash}?s=160&d=404`);
}

async function saveAvatar(userId: string, img: Img | null) {
  await db.transaction(async (tx) => {
    if (!img) {
      await tx.delete(s.avatar).where(eq(s.avatar.userId, userId));
      await tx.update(s.user).set({ image: null }).where(eq(s.user.id, userId));
      return;
    }
    await tx
      .insert(s.avatar)
      .values({ userId, ...img })
      .onConflictDoUpdate({ target: s.avatar.userId, set: { ...img, updatedAt: new Date() } });
    // The hash in the URL changes with the photo, so browsers may cache it.
    const v = createHash("sha256").update(img.data).digest("hex").slice(0, 12);
    await tx.update(s.user).set({ image: `/api/avatar/${userId}?v=${v}` }).where(eq(s.user.id, userId));
  });
}

/** Runs after every sign-in. Never throws: a missing photo must not block a login. */
export async function refreshAvatar(userId: string, providerId: string | undefined) {
  await Sentry.startSpan({ name: "avatar refresh", op: "avatar", attributes: { provider: providerId ?? "none" } }, async () => {
    try {
      const user = await db.query.user.findFirst({ where: eq(s.user.id, userId), columns: { email: true } });
      if (!user) return;
      const certilia = providerId === "certilia" ? await certiliaPhoto(userId) : null;
      const img = certilia ?? (await gravatar(user.email));
      await saveAvatar(userId, img);
      logger.info("avatar refreshed", { userId, source: certilia ? "certilia" : img ? "gravatar" : "none", bytes: img?.data.length });
    } catch (e) {
      logger.error("avatar refresh failed", { userId, error: errorMessage(e) });
      Sentry.captureException(e);
    }
  });
}
