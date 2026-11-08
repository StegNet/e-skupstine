// Shared start of the command-line scripts (migrations, make-admin, guest purge): secrets from files, Sentry and
// LogTape, configured like the app (sentry.server.config.ts).
import { readFileSync } from "node:fs";
import { configure, getConsoleSink, getJsonLinesFormatter, getLogger, withFilter } from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";
import * as Sentry from "@sentry/node";

// Under Swarm, `docker exec … node scripts/x.mts` skips the entrypoint, so read NAME_FILE secrets here too.
for (const [key, file] of Object.entries(process.env)) {
  const name = key.slice(0, -"_FILE".length);
  if (key.endsWith("_FILE") && file && !process.env[name]) process.env[name] = readFileSync(file, "utf8").trim();
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE
    ? `e-skupstina@${process.env.NEXT_PUBLIC_SENTRY_RELEASE.replace(/^v/, "")}`
    : undefined,
  tracesSampleRate: 1.0,
  dataCollection: { userInfo: false, httpBodies: [], cookies: false, urlQueryParams: false },
});

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getJsonLinesFormatter({ properties: "flatten" }) }),
    sentry: withFilter(getSentrySink({ sentry: Sentry }), "info"),
  },
  loggers: [
    { category: "e-skupstina", lowestLevel: "info", sinks: ["console", "sentry"] },
    { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
  ],
});

export const logger = getLogger(["e-skupstina", "scripts"]);

/** Error text for logs, including the causes it wraps (Drizzle hides the Postgres error in `cause`). Never the stack. */
export const errorMessage = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}${e.cause ? ` <- ${errorMessage(e.cause)}` : ""}` : String(e);

/** Sends everything queued to Sentry, then exits. */
export async function exit(code = 0): Promise<never> {
  await Sentry.flush(5000);
  process.exit(code);
}

export { Sentry };
