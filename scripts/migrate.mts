// Applies database migrations; runs on every container start before the app.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { errorMessage, exit, logger, Sentry } from "./sentry.mts";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

// Swarm has no depends_on: the app can start before Postgres accepts connections, so wait up to 3 minutes.
// Only for "not up yet" errors; a wrong password or database name fails right away below, with its real message.
const NOT_UP_YET = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "57P03"];
for (let attempt = 1; attempt <= 90; attempt++) {
  try {
    await sql`select 1`;
    break;
  } catch (e) {
    if (!NOT_UP_YET.includes((e as { code?: string }).code ?? "")) break;
    if (attempt % 5 === 1) logger.info("waiting for the database", { attempt, error: errorMessage(e) });
    await new Promise((r) => setTimeout(r, 2000));
  }
}

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
