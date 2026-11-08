import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Cache Components is off on purpose: every page is per-user and must be live while voting runs.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Left unbundled: native code (profiler), or patched at runtime for Sentry query tracing (postgres).
  serverExternalPackages: ["@react-pdf/renderer", "@sentry/profiling-node", "postgres"],
  // Signed zapisnik PDFs are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Lets Sentry's browser profiler sample JavaScript (Chromium only).
          { key: "Document-Policy", value: "js-profiling" },
        ],
      },
    ];
  },
};

export default withSentryConfig(createNextIntlPlugin("./src/i18n/request.ts")(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  debug: false,
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  release: {
    name: process.env.SENTRY_RELEASE ? `e-skupstina@${process.env.SENTRY_RELEASE.replace(/^v/, "")}` : undefined,
  },

  webpack: {
    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
