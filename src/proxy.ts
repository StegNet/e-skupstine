import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);
// The browser sends Sentry events straight to the DSN's ingest host.
const sentryOrigin = process.env.NEXT_PUBLIC_SENTRY_DSN ? ` ${new URL(process.env.NEXT_PUBLIC_SENTRY_DSN).origin}` : "";

export default function proxy(request: NextRequest) {
  const i18n = handleI18nRouting(request);
  if (i18n.headers.has("location")) return i18n;

  // Ballot secrecy depends on the JavaScript we serve, so only our own nonce-tagged scripts may run.
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${sentryOrigin}`,
    // Sentry Session Replay compresses recordings in a worker started from a blob: URL.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  // Next.js reads the nonce from the request's CSP header, so re-issue next-intl's rewrite with it.
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const rewrite = i18n.headers.get("x-middleware-rewrite");
  const res = rewrite
    ? NextResponse.rewrite(rewrite, { request: { headers } })
    : NextResponse.next({ request: { headers } });
  i18n.headers.forEach((value, key) => {
    if (!key.startsWith("x-middleware-") && key !== "set-cookie") res.headers.set(key, value);
  });
  for (const cookie of i18n.cookies.getAll()) res.cookies.set(cookie);
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
