"use server";

import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  assertStatus,
  audit,
  buildSigJson,
  canVote,
  getUser,
  isGuestUser,
  isUuid,
  loadQuestion,
  requireUser,
  resolveMember,
} from "@/lib/assembly";
import { sha256Hex } from "@/lib/ballot-crypto";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { action, UserError } from "@/lib/errors";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "participant"]);

export const joinAssembly = action("joinAssembly", async (rawCode: string) => {
  const user = await requireUser();
  const code = z
    .string()
    .regex(/^[A-Z0-9]{8}$/)
    .parse(rawCode.replace(/[\s-]/g, "").toUpperCase());
  const a = await db.query.assembly.findFirst({ where: eq(s.assembly.joinCode, code) });
  if (!a || (a.status !== "draft" && a.status !== "open")) throw new UserError("badCode");
  const guest = await isGuestUser(user.id);
  if (guest && !a.guestAccess) throw new UserError("guestAccessDisabled");
  const existing = await db.query.attendance.findFirst({
    where: and(eq(s.attendance.assemblyId, a.id), eq(s.attendance.userId, user.id)),
  });
  if (existing?.removedAt) throw new UserError("removed");
  const m = guest ? null : await resolveMember(user);
  const memberId = canVote(m) ? m!.id : null;
  await db
    .insert(s.attendance)
    .values({ assemblyId: a.id, userId: user.id, memberId, isGuest: guest })
    .onConflictDoUpdate({ target: [s.attendance.assemblyId, s.attendance.userId], set: { memberId, lastSeenAt: new Date() } });
  if (!existing) await audit(user.id, a.id, "attendance.join", { guest, member: !!memberId });
  logger.info(existing ? "rejoined assembly" : "joined assembly", { assemblyId: a.id, guest, canVote: !!memberId, status: a.status });
  return a.id;
});

/** Called by open assembly pages every few seconds; drives "present" for the quorum. */
export async function heartbeat(assemblyId: string) {
  const user = await getUser();
  if (!user || !isUuid(assemblyId)) return;
  await db
    .update(s.attendance)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(s.attendance.assemblyId, assemblyId), eq(s.attendance.userId, user.id), isNull(s.attendance.removedAt)));
}

const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(4000);
const bundleSchema = z.object({
  v: z.literal(1),
  iv: b64,
  ct: b64,
  shares: z.array(z.object({ epk: b64, iv: b64, ct: b64 })).max(50),
});

/** Stores an encrypted ballot. The server can't read it; it only checks the voter may vote once.
 * On public (non-secret) questions the ballot also records who cast it. */
export const castVote = action("castVote", async (questionId: string, bundle: string) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertStatus(ctx, "open");
  if (question.status !== "open") throw new UserError("votingClosed");
  const memberId = ctx.attendance?.memberId;
  if (!memberId) throw new UserError("notEligible");
  const m = await db.query.member.findFirst({ where: eq(s.member.id, memberId) });
  if (!canVote(m ?? null)) throw new UserError("notEligible");

  let parsed: unknown;
  try {
    parsed = JSON.parse(z.string().max(20_000).parse(bundle));
  } catch {
    throw new UserError("invalidInput");
  }
  if (bundleSchema.parse(parsed).shares.length !== ctx.committee.length) throw new UserError("invalidInput");
  const receipt = await sha256Hex(bundle);

  await db.transaction(async (tx) => {
    // Lock against a concurrent close so no ballot lands after the question closes.
    const [q] = await tx.select({ status: s.question.status }).from(s.question).where(eq(s.question.id, questionId)).for("share");
    if (q.status !== "open") throw new UserError("votingClosed");
    const done = await tx
      .insert(s.participation)
      .values({ questionId, memberId, userId: ctx.user.id })
      .onConflictDoNothing()
      .returning({ q: s.participation.questionId });
    if (!done.length) throw new UserError("alreadyVoted");
    await tx.insert(s.ballot).values({ questionId, bundle, receipt, memberId: question.secret ? null : memberId });
  });
  // Never the receipt: next to the user (which Sentry adds) it would tie this person to their ballot.
  logger.info("vote cast", { questionId, assemblyId: ctx.assembly.id, ballot: question.secret ? "secret" : "public" });
  return receipt;
});

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** Public: was a ballot with this receipt stored (and counted once published)? Reveals nothing about its content. */
export const lookupReceipt = action("lookupReceipt", async (receipt: string) => {
  const r = hex64.parse(receipt.trim().toLowerCase());
  const [row] = await db
    .select({ question: s.question.text, status: s.question.status, assembly: s.assembly.title })
    .from(s.ballot)
    .innerJoin(s.question, eq(s.question.id, s.ballot.questionId))
    .innerJoin(s.agendaItem, eq(s.agendaItem.id, s.question.agendaItemId))
    .innerJoin(s.assembly, eq(s.assembly.id, s.agendaItem.assemblyId))
    .where(eq(s.ballot.receipt, r));
  logger.info("receipt lookup", { found: !!row, status: row?.status });
  return row ?? null;
});

/** Public: which sealed zapisnik has this SHA-256, and who signed it. */
export const lookupSeal = action("lookupSeal", async (sha256: string) => {
  const h = hex64.parse(sha256);
  const [row] = await db
    .select({
      assemblyId: s.seal.assemblyId,
      title: s.assembly.title,
      sealMethod: s.assembly.sealMethod,
      sealedAt: s.seal.sealedAt,
      pdfSha256: s.seal.pdfSha256,
    })
    .from(s.seal)
    .innerJoin(s.assembly, eq(s.assembly.id, s.seal.assemblyId))
    .where(or(eq(s.seal.pdfSha256, h), eq(s.seal.signedPdfSha256, h)));
  if (!row) return null;
  const { signatures } = await buildSigJson(row.assemblyId);
  return {
    title: row.title,
    sealMethod: row.sealMethod,
    sealedAt: row.sealedAt,
    isOriginal: row.pdfSha256 === h,
    signatures,
  };
});
