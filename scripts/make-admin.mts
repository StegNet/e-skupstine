// Usage: node scripts/make-admin.mts <email|OIB>  (the person must have signed in once)
import postgres from "postgres";
import { exit, logger } from "./sentry.mts";

const who = process.argv[2];
if (!who) {
  console.error("usage: node scripts/make-admin.mts <email|OIB>");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const rows = await sql`
  update "user" set role = 'admin'
  where lower(email) = lower(${who})
     or id in (select user_id from account where provider_id = 'certilia' and account_id = ${who})
  returning name, email`;
// The terminal shows who it was; the log (and Sentry) only how many.
console.log(rows.length ? `admin: ${rows.map((r) => `${r.name} <${r.email}>`).join(", ")}` : "no such user; they must sign in once first");
logger[rows.length ? "info" : "warn"](rows.length ? "admin role granted from the command line" : "make-admin: no matching user", { users: rows.length });
await sql.end();
await exit(rows.length ? 0 : 1);
