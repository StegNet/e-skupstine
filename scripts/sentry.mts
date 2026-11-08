// Shared start of the command-line scripts (migrations, make-admin, guest purge): Sentry and LogTape, configured
// like the app (sentry.server.config.ts).
import { configure, getConsoleSink, getJsonLinesFormatter, getLogger, withFilter } from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE
    ? `e-skupstina@${process.env.NEXT_PUBLIC_SENTRY_RELEASE.replace(/^v/, "")}`
    : undefined,
  tracesSampleRate: 1.0,
  dataCollection: { userInfo: false, httpBodies: [], cookies: false, urlQueryParams: false },
  // Drizzle appends a failed query's parameters to its error message, as in sentry.server.config.ts.
  beforeSend(event) {
    for (const ex of event.exception?.values ?? []) ex.value = ex.value?.split("\nparams:")[0];
    return event;
  },
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

/** Error text for logs, including the causes it wraps (Drizzle hides the Postgres error in `cause`). Never the stack,
 * and never a failed query's parameters, which Drizzle appends to its message (OIBs, encrypted ballots). */
export const errorMessage = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message.split("\nparams:")[0]}${e.cause ? ` <- ${errorMessage(e.cause)}` : ""}` : String(e);

/** Sends everything queued to Sentry, then exits. */
export async function exit(code = 0): Promise<never> {
  await Sentry.flush(5000);
  process.exit(code);
}

export { Sentry };
