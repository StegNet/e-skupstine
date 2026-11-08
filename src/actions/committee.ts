"use server";

// Counting committee (verifikacijsko povjerenstvo): key ceremony, decrypting, confirming, sealing.
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assertCommittee,
  assertStatus,
  audit,
  certiliaOib,
  finalizeIfReady,
  loadAssembly,
  loadQuestion,
  resolveMember,
  tallyIfReady,
} from "@/lib/assembly";
import { sha256Hex, verifyBytes } from "@/lib/ballot-crypto";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import * as Sentry from "@sentry/nextjs";
import { action, UserError } from "@/lib/errors";
import { getLogger } from "@logtape/logtape";
import { verifyAppendedSignature } from "@/lib/pdf-signature";

const logger = getLogger(["e-skupstina", "committee"]);

const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(4000);
const coord = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const publicJwk = (k: unknown) => {
  if (k && typeof k === "object" && "d" in k) throw new UserError("privateKeyUploaded");
  const { x, y } = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: coord, y: coord }).parse(k);
  return { kty: "EC", crv: "P-256", x, y } satisfies JsonWebKey;
};

export const registerKeys = action("registerKeys", async (assemblyId: string, encPublic: unknown, signPublic: unknown) => {
  const ctx = await loadAssembly(assemblyId);
  assertCommittee(ctx);
  assertStatus(ctx, "draft");
  const enc = publicJwk(encPublic);
  const sign = signPublic ? publicJwk(signPublic) : null;
  if (ctx.assembly.sealMethod === "own_keys" && !sign) throw new UserError("signingKeyRequired");
  await db
    .update(s.committeeMember)
    .set({ encPublicKey: enc, signPublicKey: sign })
    .where(and(eq(s.committeeMember.assemblyId, assemblyId), eq(s.committeeMember.userId, ctx.user.id)));
  await audit(ctx.user.id, assemblyId, "committee.keys", { enc, sign });
});

export const getQuestionData = action("getQuestionData", async (questionId: string) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertCommittee(ctx);
  if (question.status === "draft" || question.status === "open") throw new UserError("wrongStatus");
  const ballots = await db
    .select({ id: s.ballot.id, bundle: s.ballot.bundle })
    .from(s.ballot)
    .where(eq(s.ballot.questionId, questionId));
  const subs = await db.select().from(s.shareSubmission).where(eq(s.shareSubmission.questionId, questionId));
  const r = await db.query.result.findFirst({ where: eq(s.result.questionId, questionId) });
  return {
    question: { id: question.id, optionsCount: question.options.length, maxChoices: question.maxChoices, threshold: ctx.assembly.threshold },
    myIndex: ctx.myIndex,
    ballots,
    // Shares are only handed out once the server has counted, for independent re-counting.
    submissions: r ? subs.map((x) => x.shares) : [],
    result: r ? { counts: r.counts, valid: r.valid, invalid: r.invalid } : null,
  };
});

export const submitShares = action("submitShares", async (questionId: string, shares: Record<string, string>) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertCommittee(ctx);
  if (question.status !== "closed") throw new UserError("wrongStatus");
  const parsed = z.record(z.uuid(), b64).parse(shares);
  const ids = new Set(
    (await db.select({ id: s.ballot.id }).from(s.ballot).where(eq(s.ballot.questionId, questionId))).map((b) => b.id),
  );
  if (Object.keys(parsed).some((k) => !ids.has(k))) throw new UserError("invalidInput");
  const inserted = await db
    .insert(s.shareSubmission)
    .values({ questionId, userId: ctx.user.id, shares: parsed })
    .onConflictDoNothing()
    .returning({ q: s.shareSubmission.questionId });
  if (!inserted.length) throw new UserError("alreadySubmitted");
  await audit(ctx.user.id, ctx.assembly.id, "committee.shares", { questionId, count: Object.keys(parsed).length });
  await tallyIfReady(questionId, ctx.assembly.threshold);
});

const tallySchema = z.object({ counts: z.array(z.number().int().min(0)), valid: z.number().int(), invalid: z.number().int() });

/** A committee member's browser re-counted independently; k matching confirmations publish the result. */
export const confirmResult = action("confirmResult", async (questionId: string, tally: unknown) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertCommittee(ctx);
  if (question.status !== "counted" && question.status !== "published") throw new UserError("wrongStatus");
  const t = tallySchema.parse(tally);
  const r = await db.query.result.findFirst({ where: eq(s.result.questionId, questionId) });
  if (!r) throw new UserError("wrongStatus");
  if (JSON.stringify([t.counts, t.valid, t.invalid]) !== JSON.stringify([r.counts, r.valid, r.invalid])) {
    await audit(ctx.user.id, ctx.assembly.id, "result.mismatch", { questionId, browser: t });
    // A browser recount disagreeing with the server is the one thing that must wake someone up.
    logger.error("result mismatch: committee recount differs from the server count", { questionId, assemblyId: ctx.assembly.id });
    Sentry.captureMessage("Result mismatch between server count and committee recount", {
      level: "error",
      tags: { questionId, assemblyId: ctx.assembly.id },
    });
    throw new UserError("resultMismatch");
  }
  await db.transaction(async (tx) => {
    await tx.insert(s.resultConfirmation).values({ questionId, userId: ctx.user.id }).onConflictDoNothing();
    await tx.select({ id: s.question.id }).from(s.question).where(eq(s.question.id, questionId)).for("update");
    const [{ n }] = await tx
      .select({ n: count() })
      .from(s.resultConfirmation)
      .where(eq(s.resultConfirmation.questionId, questionId));
    if (n >= ctx.assembly.threshold) {
      await tx
        .update(s.question)
        .set({ status: "published" })
        .where(and(eq(s.question.id, questionId), eq(s.question.status, "counted")));
    }
  });
  await audit(ctx.user.id, ctx.assembly.id, "result.confirm", { questionId });
});

async function sealContext(assemblyId: string, method: "own_keys" | "certilia_app") {
  const ctx = await loadAssembly(assemblyId);
  assertCommittee(ctx);
  assertStatus(ctx, "closed");
  if (ctx.assembly.sealMethod !== method) throw new UserError("wrongStatus");
  return ctx;
}

export const submitOwnSignature = action("submitOwnSignature", async (assemblyId: string, signature: string) => {
  const ctx = await sealContext(assemblyId, "own_keys");
  const row = await db.query.seal.findFirst({ where: eq(s.seal.assemblyId, assemblyId) });
  if (!row || row.sealedAt) throw new UserError("wrongStatus");
  const key = ctx.committee[ctx.myIndex].signPublicKey;
  const sig = b64.parse(signature);
  if (!key || !(await verifyBytes(key, new Uint8Array(row.pdf), sig))) throw new UserError("badSignature");
  const inserted = await db
    .insert(s.sealSignature)
    .values({ assemblyId, userId: ctx.user.id, signature: sig, signerName: ctx.user.name })
    .onConflictDoNothing()
    .returning({ a: s.sealSignature.assemblyId });
  if (!inserted.length) throw new UserError("alreadySigned");
  await audit(ctx.user.id, assemblyId, "seal.sign", { method: "own_keys" });
  await finalizeIfReady(assemblyId, ctx.assembly.threshold);
});

/** Upload of the zapisnik after signing it in the Certilia app; each member signs the previous member's version. */
export const submitCertiliaPdf = action("submitCertiliaPdf", async (assemblyId: string, form: FormData) => {
  const ctx = await sealContext(assemblyId, "certilia_app");
  const file = form.get("pdf");
  if (!(file instanceof File) || file.size > 20 * 1024 * 1024) throw new UserError("invalidInput");
  const oib = (await certiliaOib(ctx.user.id)) ?? (await resolveMember(ctx.user))?.oib;
  if (!oib) throw new UserError("noOib");
  const next = new Uint8Array(await file.arrayBuffer());

  const signerName = await db.transaction(async (tx) => {
    // Row lock: two members uploading at once must not overwrite each other's signature.
    const [row] = await tx.select().from(s.seal).where(eq(s.seal.assemblyId, assemblyId)).for("update");
    if (!row || row.sealedAt) throw new UserError("wrongStatus");
    const mine = await tx
      .select({ a: s.sealSignature.assemblyId })
      .from(s.sealSignature)
      .where(and(eq(s.sealSignature.assemblyId, assemblyId), eq(s.sealSignature.userId, ctx.user.id)));
    if (mine.length) throw new UserError("alreadySigned");
    const signer = await Sentry.startSpan({ name: "verify signed PDF", op: "pdf.verify" }, () =>
      verifyAppendedSignature(new Uint8Array(row.signedPdf ?? row.pdf), next),
    );
    if (signer.oib !== oib) {
      logger.warn("signed PDF refused: certificate belongs to someone else", { assemblyId, uploader: ctx.user.id });
      throw new UserError("signerMismatch");
    }
    logger.info("signed PDF accepted", { assemblyId, bytes: next.length });
    await tx
      .update(s.seal)
      .set({ signedPdf: Buffer.from(next), signedPdfSha256: await sha256Hex(next) })
      .where(eq(s.seal.assemblyId, assemblyId));
    const name = signer.name || ctx.user.name;
    await tx.insert(s.sealSignature).values({ assemblyId, userId: ctx.user.id, signature: null, signerName: name });
    return name;
  });
  await audit(ctx.user.id, assemblyId, "seal.sign", { method: "certilia_app", signerName });
  await finalizeIfReady(assemblyId, ctx.assembly.threshold);
});
