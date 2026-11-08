import { and, count, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LiveRefresh } from "@/components/live-refresh";
import { NoReplay } from "@/components/no-replay";
import { optionLabels } from "@/components/result-view";
import { StatusBadge } from "@/components/status-badge";
import { Link } from "@/i18n/navigation";
import { loadAgenda } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { pageCtx } from "@/lib/page";
import { CommitteePanel } from "./committee-panel";

export default async function CommitteePage({ params }: PageProps<"/[locale]/a/[id]/committee">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const ctx = await pageCtx(id);
  if (!ctx.isCommittee) notFound();
  const t = await getTranslations("committee");
  const a = ctx.assembly;
  const me = ctx.committee[ctx.myIndex];
  const all = (await loadAgenda(a.id)).flatMap((i) => i.questions);
  const voted = all.filter((q) => q.status !== "draft" && q.status !== "open");
  const ids = voted.map((q) => q.id);
  const tally = async (table: typeof s.shareSubmission | typeof s.resultConfirmation) =>
    ids.length
      ? db
          .select({ questionId: table.questionId, userId: table.userId })
          .from(table)
          .where(inArray(table.questionId, ids))
      : [];
  const [subs, confs, sealRow, [{ sigs }], mine] = await Promise.all([
    tally(s.shareSubmission),
    tally(s.resultConfirmation),
    db.query.seal.findFirst({ where: eq(s.seal.assemblyId, a.id), columns: { sealedAt: true } }),
    db.select({ sigs: count() }).from(s.sealSignature).where(eq(s.sealSignature.assemblyId, a.id)),
    db.query.sealSignature.findFirst({
      where: and(eq(s.sealSignature.assemblyId, a.id), eq(s.sealSignature.userId, ctx.user.id)),
    }),
  ]);

  return (
    <div className="space-y-6">
      <NoReplay />
      {a.status !== "sealed" && <LiveRefresh assemblyId={a.id} />}
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">
            {t("title")}: {a.title}
          </h1>
          <StatusBadge status={a.status} />
        </div>
        <Link href={`/a/${a.id}`} className="text-sm underline">
          {t("toParticipant")}
        </Link>
      </header>
      <CommitteePanel
        assemblyId={a.id}
        userId={ctx.user.id}
        status={a.status}
        sealMethod={a.sealMethod}
        threshold={a.threshold}
        myIndex={ctx.myIndex}
        keysRegistered={!!me.encPublicKey && (a.sealMethod !== "own_keys" || !!me.signPublicKey)}
        questions={await Promise.all(
          voted.map(async (q) => ({
            id: q.id,
            text: q.text,
            status: q.status,
            labels: await optionLabels(q),
            submissions: subs.filter((x) => x.questionId === q.id).length,
            confirmations: confs.filter((x) => x.questionId === q.id).length,
            mySubmitted: subs.some((x) => x.questionId === q.id && x.userId === ctx.user.id),
            myConfirmed: confs.some((x) => x.questionId === q.id && x.userId === ctx.user.id),
          })),
        )}
        seal={sealRow ? { sealed: !!sealRow.sealedAt, signatures: sigs, signedByMe: !!mine } : null}
        allPublished={all.every((q) => q.status === "draft" || q.status === "published")}
      />
    </div>
  );
}
