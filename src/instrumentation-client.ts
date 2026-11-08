// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { configure, getConsoleSink, withFilter } from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";

// Derive the Sentry environment at runtime from the browser hostname, since a
// single build serves both staging and production.
const host = typeof window !== "undefined" ? window.location.hostname : "";
const environment = host.includes("staging")
  ? "staging"
  : host === "localhost" || host.startsWith("127.") || host === ""
    ? "development"
    : "production";

const isDevelopment = process.env.NODE_ENV === "development" || environment === "development";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE
    ? `e-skupstina@${process.env.NEXT_PUBLIC_SENTRY_RELEASE.replace(/^v/, "")}`
    : undefined,
  environment,

  // Add optional integrations for additional features.
  // Replay masks all text and inputs by default; the ballot and committee pages stop it entirely (NoReplay).
  integrations: [
    Sentry.replayIntegration(),
    Sentry.browserTracingIntegration(),
    Sentry.browserProfilingIntegration(),
  ],

  tracesSampleRate: 1.0,
  profileSessionSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // Request bodies carry encrypted ballots, member lists (OIBs) and signed PDFs; cookies carry sessions.
    userInfo: false,
    httpBodies: [],
    cookies: false,
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

await configure({
  sinks: {
    console: withFilter(getConsoleSink(), isDevelopment ? "debug" : "info"),
    sentry: withFilter(getSentrySink({ sentry: Sentry }), "info"),
  },
  loggers: [
    {
      category: "e-skupstina",
      lowestLevel: "debug",
      sinks: ["console", "sentry"],
    },
    { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
  ],
});
