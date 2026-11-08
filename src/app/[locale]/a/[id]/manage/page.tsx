import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  closeAssembly,
  closeQuestion,
  deleteAgendaItem,
  deleteQuestion,
  generateZapisnik,
  openAssembly,
  openQuestion,
  removeCommitteeMember,
  removeGuest,
  sendInvitations,
  setGuestAccess,
} from "@/actions/manage";
import { ActionButton } from "@/components/action-button";
import { LiveRefresh } from "@/components/live-refresh";
import { ResultView } from "@/components/result-view";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { loadAgenda, missingSignerRoles, presence, PRESENCE_WINDOW_SECONDS } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { pageCtx } from "@/lib/page";
import { statut } from "@/lib/statut";
import { toZagrebLocal } from "@/lib/time";
import { AddAgendaItem, AddCommitteeMember, AddQuestion, SettingsForm } from "./manage-forms";

export default async function ManagePage({ params }: PageProps<"/[locale]/a/[id]/manage">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const ctx = await pageCtx(id);
  if (!ctx.isManager) notFound();
  const t = await getTranslations("manage");
  const ts = await getTranslations("sealMethod");
  const tr = await getTranslations("signerRole");
  const format = await getFormatter();
  const a = ctx.assembly;
  const draft = a.status === "draft";
  const editable = draft || a.status === "open";

  const [p, agenda, attendees, users, sealRow] = await Promise.all([
    presence(a.id, a.quorumPercent),
    loadAgenda(a.id),
    db
      .select({
        userId: s.attendance.userId,
        name: s.user.name,
        image: s.user.image,
        memberName: s.member.fullName,
        isGuest: s.attendance.isGuest,
        online: sql<boolean>`${s.attendance.lastSeenAt} > now() - make_interval(secs => ${PRESENCE_WINDOW_SECONDS})`,
      })
      .from(s.attendance)
      .innerJoin(s.user, eq(s.user.id, s.attendance.userId))
      .leftJoin(s.member, eq(s.member.id, s.attendance.memberId))
      .where(and(eq(s.attendance.assemblyId, a.id), isNull(s.attendance.removedAt)))
      .orderBy(asc(s.user.name)),
    draft ? db.select({ id: s.user.id, name: s.user.name, email: s.user.email }).from(s.user).orderBy(asc(s.user.name)) : [],
    db.query.seal.findFirst({ where: eq(s.seal.assemblyId, a.id), columns: { sealedAt: true, createdAt: true } }),
  ]);
  const questions = agenda.flatMap((i) => i.questions);
  const openQ = questions.find((q) => q.status === "open");
  const [{ votes }] = openQ
    ? await db.select({ votes: count() }).from(s.participation).where(eq(s.participation.questionId, openQ.id))
    : [{ votes: 0 }];
  const signedIds = (await db.select({ userId: s.sealSignature.userId }).from(s.sealSignature).where(eq(s.sealSignature.assemblyId, a.id))).map(
    (x) => x.userId,
  );
  const sigs = signedIds.length;
  const unsignedRoles = ctx.committee.filter((c) => c.role && !signedIds.includes(c.userId));
  const missingRoles = missingSignerRoles(ctx.committee);
  const keysReady = ctx.committee.filter((c) => c.encPublicKey && (a.sealMethod !== "own_keys" || c.signPublicKey)).length;
  const allPublished = questions.every((q) => q.status === "draft" || q.status === "published");
  const inviteLink = `${process.env.BETTER_AUTH_URL ?? ""}/?code=${a.joinCode}`;

  const settings = {
    title: a.title,
    type: a.type,
    scheduledAt: toZagrebLocal(a.scheduledAt),
    videoUrl: a.videoUrl ?? "",
    quorumPercent: a.quorumPercent,
    threshold: a.threshold,
    sealMethod: a.sealMethod,
    statutConfirmed: !!a.statutConfirmedAt,
  };
  const checks = [
    { ok: !!a.statutConfirmedAt, label: t("checkStatut") },
    ...(statut.videoRequired ? [{ ok: !!a.videoUrl, label: t("checkVideo") }] : []),
    { ok: ctx.committee.length >= a.threshold, label: t("checkCommittee", { n: ctx.committee.length, k: a.threshold }) },
    ...(statut.minutesSigners.length
      ? [{ ok: !missingRoles.length, label: t("checkRoles", { roles: [...new Set(statut.minutesSigners)].map((r) => tr(r)).join(", ") }) }]
      : []),
    { ok: ctx.committee.length > 0 && keysReady === ctx.committee.length, label: t("checkKeys", { ready: keysReady, n: ctx.committee.length }) },
  ];

  return (
    <div className="space-y-6">
      {a.status !== "sealed" && <LiveRefresh assemblyId={a.id} />}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <StatusBadge status={a.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            {t("joinCode")}: <code className="rounded bg-muted px-2 py-1 font-mono text-lg tracking-widest">{a.joinCode}</code>
          </span>
          <span className="break-all text-muted-foreground">{inviteLink}</span>
        </div>
        <p className="flex flex-wrap gap-3 text-sm">
          <Link href={`/a/${a.id}`} className="underline">
            {t("toParticipant")}
          </Link>
          {ctx.isCommittee && (
            <Link href={`/a/${a.id}/committee`} className="underline">
              {t("toCommittee")}
            </Link>
          )}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("session")}</CardTitle>
          <CardDescription>
            {t("presence", { present: p.present, eligible: p.eligible, percent: a.quorumPercent })}{" "}
            {p.quorumMet ? <Badge>{t("quorumMet")}</Badge> : <Badge variant="outline">{t("quorumNotMet")}</Badge>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft && (
            <>
              <ul className="space-y-1 text-sm">
                {checks.map((c) => (
                  <li key={c.label}>
                    {c.ok ? "✓" : "✗"} {c.label}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <ActionButton action={openAssembly.bind(null, a.id)} label={t("openAssembly")} disabled={!checks.every((c) => c.ok)} confirm={t("openAssemblyConfirm")} />
              </div>
            </>
          )}
          {draft && (
            <p className="text-sm text-muted-foreground">
              {a.invitedAt
                ? t("invitedAt", { date: format.dateTime(a.invitedAt, { dateStyle: "medium", timeStyle: "short" }) })
                : t("noticeHelp", { days: statut.noticeDays })}
            </p>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              {draft && (
                <ActionButton variant="outline" action={sendInvitations.bind(null, a.id)} label={t("sendInvitations")} confirm={t("sendInvitationsConfirm")} success={t("invitationsSent")} />
              )}
              {ctx.isAdmin && (
                <ActionButton
                  variant="outline"
                  action={setGuestAccess.bind(null, a.id, !a.guestAccess)}
                  label={a.guestAccess ? t("guestsOff") : t("guestsOn")}
                />
              )}
              {!ctx.isAdmin && <span className="self-center text-sm text-muted-foreground">{a.guestAccess ? t("guestsAllowed") : t("guestsBlocked")}</span>}
            </div>
          )}
          {a.status === "open" && (
            <ActionButton variant="destructive" action={closeAssembly.bind(null, a.id)} label={t("closeAssembly")} confirm={t("closeAssemblyConfirm")} disabled={!!openQ} />
          )}
          {a.status === "closed" && !sealRow && (
            <div className="space-y-2 text-sm">
              <p>{allPublished ? t("readyForZapisnik") : t("waitingForCommittee")}</p>
              <ActionButton action={generateZapisnik.bind(null, a.id)} label={t("generateZapisnik")} disabled={!allPublished} />
            </div>
          )}
          {sealRow && (
            <div className="space-y-1 text-sm">
              <p>
                {sealRow.sealedAt ? t("sealedAt", { date: format.dateTime(sealRow.sealedAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("signatures", { n: sigs, k: a.threshold, method: ts(a.sealMethod) })}
              </p>
              {!sealRow.sealedAt && unsignedRoles.length > 0 && (
                <p>{t("signaturesPending", { names: unsignedRoles.map((c) => `${c.name} (${tr(c.role!)})`).join(", ") })}</p>
              )}
              <a href={`/api/assemblies/${a.id}/zapisnik`} className="underline">
                {t("downloadZapisnik")}
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("agenda")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-4">
            {agenda.map((item, i) => (
              <li key={item.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start gap-2">
                  <h3 className="flex-1 font-medium">
                    {i + 1}. {item.title}
                  </h3>
                  {editable && item.questions.every((q) => q.status === "draft") && (
                    <ActionButton size="sm" variant="ghost" action={deleteAgendaItem.bind(null, a.id, item.id)} label={t("delete")} confirm={t("deleteConfirm")} />
                  )}
                </div>
                {item.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{item.description}</p>}
                {item.questions.map((q) => (
                  <div key={q.id} className="space-y-2 border-t pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-sm">{q.text}</span>
                      <Badge variant="outline">{q.secret ? t("ballotSecret") : t("ballotPublic")}</Badge>
                      <Badge variant="outline">{q.resultsVisibility === "public" ? t("visPublic") : t("visRestricted")}</Badge>
                      <StatusBadge status={q.status} kind="question" />
                      {q.status === "draft" && a.status === "open" && (
                        <ActionButton size="sm" action={openQuestion.bind(null, q.id)} label={t("openQuestion")} disabled={!!openQ || !p.quorumMet} />
                      )}
                      {q.status === "open" && (
                        <ActionButton size="sm" variant="destructive" action={closeQuestion.bind(null, q.id)} label={t("closeQuestion")} confirm={t("closeQuestionConfirm")} />
                      )}
                      {q.status === "draft" && editable && (
                        <ActionButton size="sm" variant="ghost" action={deleteQuestion.bind(null, q.id)} label={t("delete")} confirm={t("deleteConfirm")} />
                      )}
                    </div>
                    {q.status === "open" && <p className="text-sm">{t("votesSoFar", { votes, present: q.presentAtOpen ?? 0 })}</p>}
                    {(q.status === "counted" || q.status === "published") && <ResultView q={q} />}
                    {q.status === "closed" && <p className="text-xs text-muted-foreground">{t("awaitingCount")}</p>}
                  </div>
                ))}
                {editable && (
                  <AddQuestion
                    assemblyId={a.id}
                    itemId={item.id}
                    defaults={{ base: statut.majority.base, fraction: statut.majority.fraction, secret: statut.secretBallotByDefault }}
                  />
                )}
              </li>
            ))}
          </ol>
          {editable && <AddAgendaItem assemblyId={a.id} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("attendance", { n: attendees.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead>{t("online")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {attendees.map((x) => (
                <TableRow key={x.userId}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <UserAvatar name={x.memberName ?? x.name} image={x.image} size="sm" />
                      {x.memberName ?? x.name}
                    </span>
                  </TableCell>
                  <TableCell>{x.isGuest ? t("guest") : x.memberName ? t("member") : t("observer")}</TableCell>
                  <TableCell>{x.online ? "●" : "○"}</TableCell>
                  <TableCell className="text-right">
                    {x.isGuest && <ActionButton size="sm" variant="ghost" action={removeGuest.bind(null, a.id, x.userId)} label={t("remove")} confirm={t("removeConfirm")} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("committee")}</CardTitle>
          <CardDescription>{t("committeeHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm">
            {ctx.committee.map((c) => (
              <li key={c.userId} className="flex items-center gap-2">
                <span className="flex-1">
                  {c.name}
                  {c.role && <span className="text-muted-foreground"> · {tr(c.role)}</span>}
                </span>
                <span className="text-muted-foreground">{c.encPublicKey ? t("keyReady") : t("keyMissing")}</span>
                {draft && <ActionButton size="sm" variant="ghost" action={removeCommitteeMember.bind(null, a.id, c.userId)} label={t("remove")} />}
              </li>
            ))}
          </ul>
          {draft && (
            <AddCommitteeMember
              assemblyId={a.id}
              roles={missingRoles}
              users={users.filter((u) => !ctx.committee.some((c) => c.userId === u.id)).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings")}</CardTitle>
        </CardHeader>
        <CardContent>
          {draft ? (
            // Keyed by the saved values so the uncontrolled inputs pick up changes made elsewhere.
            <SettingsForm key={JSON.stringify(settings)} assemblyId={a.id} s={settings} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("settingsLocked", { percent: a.quorumPercent, k: a.threshold, method: ts(a.sealMethod) })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
