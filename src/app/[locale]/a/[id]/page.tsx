import { and, eq } from "drizzle-orm";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { LiveRefresh } from "@/components/live-refresh";
import { NoReplay } from "@/components/no-replay";
import { ResultView, optionLabels } from "@/components/result-view";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { loadAgenda, presence } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { pageCtx } from "@/lib/page";
import { JoinForm } from "../../home-client";
import { MyReceipts, ReceiptNote, VotePanel } from "./vote-panel";

export default async function AssemblyPage({ params }: PageProps<"/[locale]/a/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const ctx = await pageCtx(id);
  const t = await getTranslations("assembly");
  const tt = await getTranslations("assemblyType");
  const format = await getFormatter();
  const a = ctx.assembly;
  const privileged = ctx.isManager || ctx.isCommittee;

  if (!ctx.attendance && !privileged) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>{a.title}</CardTitle>
          <CardDescription>{t("notJoined")}</CardDescription>
        </CardHeader>
        <CardContent>
          <JoinForm />
        </CardContent>
      </Card>
    );
  }

  const [p, agenda] = await Promise.all([presence(a.id, a.quorumPercent), loadAgenda(a.id)]);
  const questions = agenda.flatMap((i) => i.questions);
  const open = questions.find((q) => q.status === "open");
  const memberId = ctx.attendance?.memberId;
  const voted =
    open && memberId
      ? !!(await db.query.participation.findFirst({
          where: and(eq(s.participation.questionId, open.id), eq(s.participation.memberId, memberId)),
        }))
      : false;
  const canSeeCounts = (q: (typeof questions)[number]) =>
    q.status === "published" && (q.resultsVisibility === "public" || privileged);

  return (
    <div className="space-y-6">
      <NoReplay />
      {a.status !== "sealed" && <LiveRefresh assemblyId={a.id} />}
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <StatusBadge status={a.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {tt(a.type)}
          {a.scheduledAt && ` · ${format.dateTime(a.scheduledAt, { dateStyle: "long", timeStyle: "short" })}`}
          {" · "}
          {t("presence", { present: p.present, eligible: p.eligible })}
          {" · "}
          {p.quorumMet ? t("quorumMet") : t("quorumNotMet")}
        </p>
        {a.videoUrl && (a.status === "draft" || a.status === "open") && (
          <p className="text-sm">
            {t("videoCall")}:{" "}
            <a href={a.videoUrl} target="_blank" rel="noopener noreferrer" className="break-all underline">
              {a.videoUrl}
            </a>
          </p>
        )}
        {privileged && (
          <p className="flex gap-3 text-sm">
            {ctx.isManager && (
              <Link href={`/a/${a.id}/manage`} className="underline">
                {t("toManage")}
              </Link>
            )}
            {ctx.isCommittee && (
              <Link href={`/a/${a.id}/committee`} className="underline">
                {t("toCommittee")}
              </Link>
            )}
          </p>
        )}
      </header>

      {ctx.attendance?.isGuest && (
        <Alert>
          <AlertDescription>{t("guestWatchOnly")}</AlertDescription>
        </Alert>
      )}
      {ctx.attendance && !ctx.attendance.isGuest && !memberId && (
        <Alert>
          <AlertDescription>{t("observerOnly")}</AlertDescription>
        </Alert>
      )}
      {a.status === "draft" && (
        <Alert>
          <AlertDescription>{t("notOpenYet")}</AlertDescription>
        </Alert>
      )}

      {open && (
        <Card className="border-primary">
          <CardHeader>
            <CardDescription>{t("votingNow")}</CardDescription>
            <CardTitle className="text-xl">{open.text}</CardTitle>
          </CardHeader>
          <CardContent>
            {!memberId ? (
              <p className="text-sm text-muted-foreground">{t("cannotVote")}</p>
            ) : voted ? (
              <ReceiptNote questionId={open.id} />
            ) : (
              <VotePanel
                assemblyId={a.id}
                question={{ id: open.id, text: open.text, maxChoices: open.maxChoices, secret: open.secret }}
                labels={await optionLabels(open)}
                committeeKeys={ctx.committee.map((c) => c.encPublicKey!)}
                threshold={a.threshold}
              />
            )}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("agenda")}</h2>
        {agenda.length === 0 && <p className="text-sm text-muted-foreground">{t("noAgenda")}</p>}
        <ol className="space-y-4">
          {agenda.map((item, i) => (
            <li key={item.id} className="rounded-lg border p-4">
              <h3 className="font-medium">
                {i + 1}. {item.title}
              </h3>
              {item.description && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.description}</p>}
              {item.questions.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {item.questions.map((q) => (
                    <li key={q.id} className="space-y-2 border-t pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">{q.text}</span>
                        <StatusBadge status={q.status} kind="question" />
                      </div>
                      {canSeeCounts(q) ? (
                        <ResultView q={q} />
                      ) : q.status === "published" ? (
                        <p className="text-xs text-muted-foreground">{t("restricted")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      {a.status === "sealed" && (
        <Alert>
          <AlertDescription>
            {t("sealed")}{" "}
            <a href={`/api/assemblies/${a.id}/zapisnik`} className="underline">
              {t("downloadZapisnik")}
            </a>
          </AlertDescription>
        </Alert>
      )}

      <MyReceipts assemblyId={a.id} />
    </div>
  );
}
