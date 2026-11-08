// Usage: node scripts/purge-guests.mts [days=90]
// Deletes guests (email-code logins) older than N days whose every session has been sealed for at least N days.
// Run it periodically (e.g. a weekly cron: docker compose exec app node scripts/purge-guests.mts 90).
import postgres from "postgres";
import { errorMessage, exit, logger, Sentry } from "./sentry.mts";

const days = Number(process.argv[2] ?? 90);
if (!Number.isInteger(days) || days < 0) {
  console.error("usage: node scripts/purge-guests.mts [days]");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
// A Sentry cron monitor: a missed or failed weekly run raises an alert. The schedule matches the README's cron line.
const purge = () => sql.begin(async (tx) => {
  const rows = await tx`
    select u.id from "user" u
    where u.created_at < now() - make_interval(days => ${days})
      and u.role <> 'admin'
      and not exists (select 1 from account a where a.user_id = u.id and a.provider_id in ('certilia', 'okta'))
      and not exists (select 1 from assembly s where s.host_id = u.id)
      and not exists (select 1 from committee_member c where c.user_id = u.id)
      and not exists (
        select 1 from attendance t left join seal x on x.assembly_id = t.assembly_id
        where t.user_id = u.id and (x.sealed_at is null or x.sealed_at > now() - make_interval(days => ${days})))`;
  const ids = rows.map((r) => r.id as string);
  if (!ids.length) return 0;
  await tx`delete from attendance where user_id in ${tx(ids)}`;
  await tx`delete from "user" where id in ${tx(ids)}`; // sessions and accounts cascade
  return ids.length;
});
try {
  const deleted = await Sentry.withMonitor("purge-guests", purge, {
    schedule: { type: "crontab", value: "0 3 * * 1" },
    timezone: "Europe/Zagreb",
    checkinMargin: 60,
    maxRuntime: 10,
  });
  logger.info("guest purge done", { deleted, days });
} catch (e) {
  Sentry.captureException(e);
  logger.error("guest purge failed", { error: errorMessage(e) });
  await sql.end();
  await exit(1);
}
await sql.end();
await exit(0);
