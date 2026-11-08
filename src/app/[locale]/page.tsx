import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { getUser, isAdmin, isGuestUser, resolveMember, canVote } from "@/lib/assembly";
import { guestAccessOpen, loginProviders } from "@/lib/auth";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { JoinForm, LoginButtons } from "./home-client";

export default async function Home({ params, searchParams }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : undefined;
  const t = await getTranslations("home");
  const user = await getUser();

  if (!user) {
    const guests = await guestAccessOpen();
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl">{t("title")}</CardTitle>
          <CardDescription>{t("intro")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sp.error && (
            <Alert variant="destructive">
              <AlertDescription>{t("signInFailed")}</AlertDescription>
            </Alert>
          )}
          {loginProviders.length ? (
            <LoginButtons providers={loginProviders} callbackURL={code ? `/?code=${encodeURIComponent(code)}` : "/"} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noProviders")}</p>
          )}
          {guests && (
            <p className="text-sm">
              <Link href={code ? `/guest?code=${encodeURIComponent(code)}` : "/guest"} className="underline">
                {t("guestLink")}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const format = await getFormatter();
  const guest = await isGuestUser(user.id);
  const voter = !guest && canVote(await resolveMember(user));
  const admin = isAdmin(user);
  const mine = admin
    ? undefined
    : or(
        eq(s.assembly.hostId, user.id),
        inArray(
          s.assembly.id,
          db.select({ id: s.committeeMember.assemblyId }).from(s.committeeMember).where(eq(s.committeeMember.userId, user.id)),
        ),
        inArray(
          s.assembly.id,
          db
            .select({ id: s.attendance.assemblyId })
            .from(s.attendance)
            .where(and(eq(s.attendance.userId, user.id), isNull(s.attendance.removedAt))),
        ),
      );
  const assemblies = await db.select().from(s.assembly).where(mine).orderBy(desc(s.assembly.createdAt));
  const committeeOf = new Set(
    (await db.select({ id: s.committeeMember.assemblyId }).from(s.committeeMember).where(eq(s.committeeMember.userId, user.id))).map(
      (r) => r.id,
    ),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("joinTitle")}</CardTitle>
          <CardDescription>{t("joinHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <JoinForm defaultCode={code} />
          {!voter && (
            <p className="text-sm text-muted-foreground">{guest ? t("guestNotice") : t("notMemberNotice")}</p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("myAssemblies")}</h2>
        {assemblies.length === 0 && <p className="text-sm text-muted-foreground">{t("none")}</p>}
        <ul className="divide-y rounded-lg border">
          {assemblies.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Link href={`/a/${a.id}`} className="font-medium hover:underline">
                  {a.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {a.scheduledAt ? format.dateTime(a.scheduledAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                </p>
              </div>
              <StatusBadge status={a.status} />
              {(admin || a.hostId === user.id) && (
                <Link href={`/a/${a.id}/manage`} className="text-sm underline">
                  {t("manage")}
                </Link>
              )}
              {committeeOf.has(a.id) && (
                <Link href={`/a/${a.id}/committee`} className="text-sm underline">
                  {t("committee")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
