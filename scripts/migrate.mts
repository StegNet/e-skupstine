// Applies database migrations; runs on every container start before the app.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { errorMessage, exit, logger, Sentry } from "./sentry.mts";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
try {
  const started = Date.now();
  await Sentry.startSpan({ name: "migrate", op: "db.migrate" }, () => migrate(drizzle(sql), { migrationsFolder: "drizzle" }));
  logger.info("migrations applied", { ms: Date.now() - started });
} catch (e) {
  // The app does not start after this, so make sure someone hears about it.
  Sentry.captureException(e);
  logger.fatal("migrations failed", { error: errorMessage(e) });
  await sql.end();
  await exit(1);
}
await sql.end();
await exit(0);
