// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { configure, getConsoleSink, getJsonLinesFormatter, withFilter } from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";

// Same environment names as the browser, from the app's public hostname.
const host = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).hostname : "";
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

  integrations: [nodeProfilingIntegration(), Sentry.postgresJsIntegration()],

  tracesSampleRate: 1.0,
  profileSessionSampleRate: 1.0,
  profileLifecycle: "trace",

  // Stack-frame variables would include decrypted ballots while votes are counted.
  includeLocalVariables: false,

  dataCollection: {
    // Request bodies carry encrypted ballots, member lists (OIBs) and signed PDFs; cookies carry sessions;
    // query strings carry sign-in codes.
    userInfo: false,
    httpBodies: [],
    cookies: false,
    urlQueryParams: false,
  },
});

await configure({
  sinks: {
    // JSON lines with every property, so `docker logs` show the ids and errors, not just the message.
    console: withFilter(getConsoleSink({ formatter: getJsonLinesFormatter({ properties: "flatten" }) }), isDevelopment ? "debug" : "info"),
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
