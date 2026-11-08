import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "actions"]);

/** An expected, user-facing failure. The message is a key under "errors" in messages/*.json. */
export class UserError extends Error {}

/** Error text for logs: the message only, never the stack or attached data. */
export const errorMessage = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Wraps a server action: a Sentry span named after it, a log line for every outcome, and expected failures
 * returned as values (production builds hide thrown error messages). Unexpected errors go to Sentry. */
export function action<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<Result<R>> =>
    // recordResponse stays off: some actions return a ballot receipt, which must never be stored next to a user.
    Sentry.withServerActionInstrumentation(name, { headers: headers(), recordResponse: false }, async () => {
      const started = performance.now();
      const ms = () => Math.round(performance.now() - started);
      try {
        const data = await fn(...args);
        logger.info(`action ${name} ok`, { action: name, ms: ms() });
        return { ok: true as const, data };
      } catch (e) {
        if (e instanceof UserError) {
          logger.warn(`action ${name} refused: ${e.message}`, { action: name, error: e.message, ms: ms() });
          return { ok: false as const, error: e.message };
        }
        if (e instanceof ZodError) {
          // Field paths only; the submitted values could be anything.
          const fields = [...new Set(e.issues.map((i) => i.path.join(".") || "(root)"))].join(",");
          logger.warn(`action ${name} invalid input`, { action: name, fields, ms: ms() });
          return { ok: false as const, error: "invalidInput" };
        }
        logger.error(`action ${name} failed`, { action: name, error: errorMessage(e), ms: ms() });
        throw e;
      }
    });
}
