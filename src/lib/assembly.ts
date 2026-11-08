// Server-side domain logic: who may do what in an assembly, presence/quorum, tally and sealing.
import * as Sentry from "@sentry/nextjs";
import { and, asc, count, countDistinct, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { auth, MEMBER_PROVIDERS, type SessionUser } from "./auth";
import { receiptsDigest, tallyBallots } from "./ballot-crypto";
import { db } from "./db";
import * as s from "./db/schema";
import { UserError } from "./errors";
import { getLogger } from "@logtape/logtape";
import { sendMail } from "./mail";
import { isAdopted, quorumMet } from "./rules";
import { statut } from "./statut";

const logger = getLogger(["e-skupstina", "assembly"]);

export const PRESENCE_WINDOW_SECONDS = 45;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user ?? null;
  // Only the internal id and role go to Sentry, never name, email or OIB.
  Sentry.setUser(user ? { id: user.id } : null);
  if (user) Sentry.setTag("role", user.role);
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) throw new UserError("signInRequired");
  return user;
}

export const isAdmin = (u: SessionUser) => u.role === "admin";

export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new UserError("forbidden");
  return user;
}

async function hasProvider(userId: string, providers: string[]) {
  const rows = await db
    .select({ id: s.account.id })
    .from(s.account)
    .where(and(eq(s.account.userId, userId), inArray(s.account.providerId, providers)))
    .limit(1);
  return rows.length > 0;
}

/** Guests signed in with an email code only; they can watch but never vote. */
export const isGuestUser = async (userId: string) => !(await hasProvider(userId, MEMBER_PROVIDERS));

/** The OIB a Certilia login proved: Better Auth stores it as the account subject. */
export async function certiliaOib(userId: string) {
  const [row] = await db
    .select({ oib: s.account.accountId })
    .from(s.account)
    .where(and(eq(s.account.userId, userId), eq(s.account.providerId, "certilia")))
    .limit(1);
  return row?.oib ?? null;
}

/** The member this login proves: by OIB for Certilia, by email for Okta. */
export async function resolveMember(user: SessionUser) {
  const oib = await certiliaOib(user.id);
  let m: typeof s.member.$inferSelect | null = null;
  if (oib) m = (await db.query.member.findFirst({ where: eq(s.member.oib, oib) })) ?? null;
  else if (await hasProvider(user.id, ["okta"])) {
    m = (await db.query.member.findFirst({ where: eq(sql`lower(${s.member.email})`, user.email.toLowerCase()) })) ?? null;
  }
  logger.debug("member lookup", { userId: user.id, via: oib ? "certilia" : "okta-or-none", matched: !!m, memberId: m?.id });
  return m;
}

const today = () => new Date().toISOString().slice(0, 10);
export const canVote = (m: typeof s.member.$inferSelect | null) => !!m && m.votingRight && (!m.leftAt || m.leftAt > today());
const currentMember = or(isNull(s.member.leftAt), gt(s.member.leftAt, sql`current_date`));
const eligibleMembers = and(eq(s.member.votingRight, true), currentMember);

export async function loadAssembly(assemblyId: string) {
  if (!UUID.test(assemblyId)) throw new UserError("notFound");
  const user = await requireUser();
  const assembly = await db.query.assembly.findFirst({ where: eq(s.assembly.id, assemblyId) });
  if (!assembly) throw new UserError("notFound");
  const committee = await db
    .select({
      userId: s.committeeMember.userId,
      name: s.user.name,
      role: s.committeeMember.role,
      encPublicKey: s.committeeMember.encPublicKey,
      signPublicKey: s.committeeMember.signPublicKey,
    })
    .from(s.committeeMember)
    .innerJoin(s.user, eq(s.user.id, s.committeeMember.userId))
    .where(eq(s.committeeMember.assemblyId, assemblyId))
    .orderBy(asc(s.committeeMember.position));
  const attendance = await db.query.attendance.findFirst({
    where: and(eq(s.attendance.assemblyId, assemblyId), eq(s.attendance.userId, user.id)),
  });
  const admin = isAdmin(user);
  const myIndex = committee.findIndex((c) => c.userId === user.id);
  return {
    user,
    assembly,
    committee,
    attendance: attendance?.removedAt ? undefined : attendance,
    isAdmin: admin,
    isManager: admin || assembly.hostId === user.id,
    myIndex,
    isCommittee: myIndex >= 0,
  };
}
export type AssemblyCtx = Awaited<ReturnType<typeof loadAssembly>>;

export async function loadQuestion(questionId: string) {
  if (!UUID.test(questionId)) throw new UserError("notFound");
  const row = await db
    .select({ question: s.question, assemblyId: s.agendaItem.assemblyId })
    .from(s.question)
    .innerJoin(s.agendaItem, eq(s.agendaItem.id, s.question.agendaItemId))
    .where(eq(s.question.id, questionId));
  if (!row[0]) throw new UserError("notFound");
  return { question: row[0].question, ctx: await loadAssembly(row[0].assemblyId) };
}

export function assertManager(ctx: AssemblyCtx) {
  if (!ctx.isManager) throw new UserError("forbidden");
}
export function assertCommittee(ctx: AssemblyCtx) {
  if (!ctx.isCommittee) throw new UserError("forbidden");
}
export function assertStatus(ctx: AssemblyCtx, ...allowed: (typeof s.assembly.$inferSelect)["status"][]) {
  if (!allowed.includes(ctx.assembly.status)) throw new UserError("wrongStatus");
}

export async function presence(assemblyId: string, quorumPercent: number) {
  const [{ present }] = await db
    .select({ present: countDistinct(s.attendance.memberId) })
    .from(s.attendance)
    .where(
      and(
        eq(s.attendance.assemblyId, assemblyId),
        isNull(s.attendance.removedAt),
        isNotNull(s.attendance.memberId),
        gt(s.attendance.lastSeenAt, sql`now() - make_interval(secs => ${PRESENCE_WINDOW_SECONDS})`),
      ),
    );
  const [{ eligible }] = await db.select({ eligible: count() }).from(s.member).where(eligibleMembers);
  const met = quorumMet(present, eligible, quorumPercent);
  logger.trace("presence", { assemblyId, present, eligible, quorumPercent, quorumMet: met });
  return { present, eligible, quorumMet: met };
}

/** Invitations go to every current member: members without a vote may still attend. */
export async function currentMembersWithEmail() {
  return db
    .select({ fullName: s.member.fullName, email: s.member.email })
    .from(s.member)
    .where(and(currentMember, isNotNull(s.member.email)));
}

/** Statut signer roles (minutesSigners) not yet given to a committee member. */
export function missingSignerRoles(committee: { role: string | null }[]) {
  const need: string[] = [...statut.minutesSigners];
  for (const c of committee) {
    const i = c.role ? need.indexOf(c.role) : -1;
    if (i >= 0) need.splice(i, 1);
  }
  return need;
}

/** Writes the audit trail (database) and a log line. The detail stays in the database only: it can hold results. */
export async function audit(actorId: string | null, assemblyId: string | null, action: string, detail?: unknown) {
  await db.insert(s.auditLog).values({ actorId, assemblyId, action, detail });
  logger.info(`audit ${action}`, { audit: action, actorId, assemblyId });
}

/** Runs the server-side tally once k committee members have submitted their shares. Idempotent. */
export async function tallyIfReady(questionId: string, threshold: number) {
  await Sentry.startSpan({ name: "tally", op: "ballot.tally", attributes: { questionId } }, () => tally(questionId, threshold));
}

async function tally(questionId: string, threshold: number) {
  await db.transaction(async (tx) => {
    const [q] = await tx.select().from(s.question).where(eq(s.question.id, questionId)).for("update");
    if (q?.status !== "closed") {
      logger.debug("tally skipped: question not closed", { questionId, status: q?.status });
      return;
    }
    const subs = await tx.select().from(s.shareSubmission).where(eq(s.shareSubmission.questionId, questionId));
    if (subs.length < threshold) {
      logger.info("tally waiting for key shares", { questionId, submitted: subs.length, needed: threshold });
      return;
    }
    const ballots = await tx
      .select({ id: s.ballot.id, bundle: s.ballot.bundle, receipt: s.ballot.receipt, name: s.member.fullName })
      .from(s.ballot)
      .leftJoin(s.member, eq(s.member.id, s.ballot.memberId))
      .where(eq(s.ballot.questionId, questionId));
    const t = await tallyBallots(
      { id: q.id, optionsCount: q.options.length, maxChoices: q.maxChoices, threshold },
      ballots,
      subs.map((x) => x.shares),
    );
    const roll = q.secret
      ? null
      : ballots.map((b) => ({ name: b.name ?? "?", choices: t.choices[b.id] })).sort((x, y) => x.name.localeCompare(y.name, "hr"));
    await tx.insert(s.result).values({
      questionId,
      counts: t.counts,
      valid: t.valid,
      invalid: t.invalid,
      roll,
      adopted: isAdopted(q, t.counts, t.valid),
      receiptsDigest: await receiptsDigest(ballots.map((b) => b.receipt)),
    });
    await tx.update(s.question).set({ status: "counted" }).where(eq(s.question.id, questionId));
    // Ballot numbers only: the counts themselves may be restricted to the host and committee.
    logger.info("question counted", { questionId, ballots: ballots.length, invalid: t.invalid, secret: q.secret });
    if (t.invalid) logger.warn("invalid ballots in count", { questionId, invalid: t.invalid });
  });
}

/** Seals the assembly once k committee signatures are in, including every statut signer (chair, recorder…),
 * then mails the zapisnik to everyone who voted and the host. */
export async function finalizeIfReady(assemblyId: string, threshold: number) {
  const sealed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.seal).where(eq(s.seal.assemblyId, assemblyId)).for("update");
    if (!row || row.sealedAt) return false;
    const [{ n }] = await tx.select({ n: count() }).from(s.sealSignature).where(eq(s.sealSignature.assemblyId, assemblyId));
    const [{ unsigned }] = await tx
      .select({ unsigned: count() })
      .from(s.committeeMember)
      .leftJoin(
        s.sealSignature,
        and(eq(s.sealSignature.assemblyId, s.committeeMember.assemblyId), eq(s.sealSignature.userId, s.committeeMember.userId)),
      )
      .where(and(eq(s.committeeMember.assemblyId, assemblyId), isNotNull(s.committeeMember.role), isNull(s.sealSignature.userId)));
    if (n < threshold || unsigned > 0) {
      logger.info("seal waiting for signatures", { assemblyId, signatures: n, needed: threshold, statutSignersMissing: unsigned });
      return false;
    }
    await tx.update(s.seal).set({ sealedAt: new Date() }).where(eq(s.seal.assemblyId, assemblyId));
    await tx.update(s.assembly).set({ status: "sealed" }).where(eq(s.assembly.id, assemblyId));
    return true;
  });
  if (sealed) {
    logger.info("assembly sealed", { assemblyId });
    await Sentry.startSpan({ name: "mail sealed minutes", op: "mail.batch", attributes: { assemblyId } }, () => mailSealedResults(assemblyId));
  }
}

export async function buildSigJson(assemblyId: string) {
  const row = await db.query.seal.findFirst({ where: eq(s.seal.assemblyId, assemblyId) });
  const sigs = await db
    .select({ name: s.sealSignature.signerName, signature: s.sealSignature.signature, publicKeyJwk: s.committeeMember.signPublicKey })
    .from(s.sealSignature)
    .innerJoin(
      s.committeeMember,
      and(eq(s.committeeMember.assemblyId, s.sealSignature.assemblyId), eq(s.committeeMember.userId, s.sealSignature.userId)),
    )
    .where(eq(s.sealSignature.assemblyId, assemblyId));
  return {
    format: "e-skupstina/own-keys/v1",
    algorithm: "ECDSA P-256 with SHA-256 over the PDF bytes; signature is IEEE P1363 (r||s), base64",
    pdfSha256: row?.pdfSha256,
    signatures: sigs,
  };
}

async function mailSealedResults(assemblyId: string) {
  const a = await db.query.assembly.findFirst({ where: eq(s.assembly.id, assemblyId) });
  const row = await db.query.seal.findFirst({ where: eq(s.seal.assemblyId, assemblyId) });
  if (!a || !row) return;
  const voters = await db
    .selectDistinct({ email: s.user.email })
    .from(s.participation)
    .innerJoin(s.question, eq(s.question.id, s.participation.questionId))
    .innerJoin(s.agendaItem, eq(s.agendaItem.id, s.question.agendaItemId))
    .innerJoin(s.user, eq(s.user.id, s.participation.userId))
    .where(eq(s.agendaItem.assemblyId, assemblyId));
  const host = await db.query.user.findFirst({ where: eq(s.user.id, a.hostId), columns: { email: true } });
  const recipients = [...new Set([...voters.map((v) => v.email), ...(host ? [host.email] : [])])];

  const attachments = [{ filename: "zapisnik.pdf", content: row.signedPdf ?? row.pdf, contentType: "application/pdf" }];
  if (a.sealMethod === "own_keys") {
    attachments.push({
      filename: "zapisnik.sig.json",
      content: Buffer.from(JSON.stringify(await buildSigJson(assemblyId), null, 2)),
      contentType: "application/json",
    });
  }
  const verifyUrl = `${process.env.BETTER_AUTH_URL ?? ""}/verify`;
  const text = [
    `Zapisnik sjednice skupštine "${a.title}" zapečaćen je potpisima povjerenstva i nalazi se u privitku.`,
    a.sealMethod === "own_keys"
      ? `Potpise provjerite na ${verifyUrl}.`
      : "Kvalificirane potpise provjerite u Adobe Acrobat Readeru ili na https://ec.europa.eu/digital-building-blocks/DSS/webapp-demo/validation.",
    "U privitku potražite i svoje potvrde glasovanja (vidljive su vam nakon glasovanja) da biste provjerili da je vaš glas prebrojan.",
    "",
    `The minutes of the assembly "${a.title}" have been sealed by the counting committee and are attached.`,
    a.sealMethod === "own_keys"
      ? `Verify the signatures at ${verifyUrl}.`
      : "Verify the qualified signatures in Adobe Acrobat Reader or at https://ec.europa.eu/digital-building-blocks/DSS/webapp-demo/validation.",
    "Look up your voting receipts in the attachment to check that your vote was counted.",
  ].join("\n");

  let sent = 0;
  const failed: string[] = [];
  for (const to of recipients) {
    try {
      if (await sendMail({ to, subject: `Zapisnik / Minutes: ${a.title}`, text, attachments, kind: "minutes" })) sent++;
    } catch {
      failed.push(to); // sendMail logged the reason
    }
  }
  logger.info("sealed minutes mailed", { assemblyId, recipients: recipients.length, sent, failed: failed.length });
  await audit(null, assemblyId, "seal.mailed", { sent, failed });
}

/** Agenda items with their questions and (if counted) results, in order. Callers decide what each viewer may see. */
export async function loadAgenda(assemblyId: string) {
  const items = await db.query.agendaItem.findMany({
    where: eq(s.agendaItem.assemblyId, assemblyId),
    orderBy: asc(s.agendaItem.position),
  });
  const rows = items.length
    ? await db
        .select({ q: s.question, r: s.result })
        .from(s.question)
        .leftJoin(s.result, eq(s.result.questionId, s.question.id))
        .where(inArray(s.question.agendaItemId, items.map((i) => i.id)))
        .orderBy(asc(s.question.position))
    : [];
  return items.map((item) => ({
    ...item,
    questions: rows.filter((x) => x.q.agendaItemId === item.id).map((x) => ({ ...x.q, result: x.r })),
  }));
}
export type AgendaQuestion = Awaited<ReturnType<typeof loadAgenda>>[number]["questions"][number];
