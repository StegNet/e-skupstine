"use server";

// Host (or admin) actions for preparing and running an assembly.
import { and, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { z } from "zod";
import {
  assertManager,
  assertStatus,
  audit,
  currentMembersWithEmail,
  loadAssembly,
  loadQuestion,
  missingSignerRoles,
  presence,
} from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { action, UserError } from "@/lib/errors";
import { getLogger } from "@logtape/logtape";
import { sendMail } from "@/lib/mail";
import { renderZapisnik } from "@/lib/zapisnik";
import { sha256Hex } from "@/lib/ballot-crypto";
import { SIGNER_ROLES, statut } from "@/lib/statut";
import { fromZagrebLocal } from "@/lib/time";

const logger = getLogger(["e-skupstina", "manage"]);

async function manager(assemblyId: string) {
  const ctx = await loadAssembly(assemblyId);
  assertManager(ctx);
  return ctx;
}

const settingsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["redovna", "izborna", "izvanredna"]),
  scheduledAt: z.string().optional(),
  videoUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(500)]).optional(),
  quorumPercent: z.coerce.number().int().min(0).max(99),
  threshold: z.coerce.number().int().min(2).max(20),
  sealMethod: z.enum(["certilia_app", "own_keys"]),
  statutConfirmed: z.literal("on").optional(),
});

export const updateSettings = action("updateSettings", async (assemblyId: string, form: FormData) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft");
  const d = settingsSchema.parse(Object.fromEntries(form));
  const scheduledAt = d.scheduledAt ? fromZagrebLocal(d.scheduledAt) : null;
  const sameDate = scheduledAt?.getTime() === ctx.assembly.scheduledAt?.getTime();
  await db
    .update(s.assembly)
    .set({
      title: d.title,
      type: d.type,
      scheduledAt,
      videoUrl: d.videoUrl || null,
      // Invitations named the old date, so they no longer count as notice.
      invitedAt: sameDate ? ctx.assembly.invitedAt : null,
      quorumPercent: d.quorumPercent,
      threshold: d.threshold,
      sealMethod: d.sealMethod,
      statutConfirmedAt: d.statutConfirmed ? (ctx.assembly.statutConfirmedAt ?? new Date()) : null,
    })
    .where(eq(s.assembly.id, assemblyId));
  await audit(ctx.user.id, assemblyId, "assembly.settings", d);
});

/** Only an administrator may let guests in (the brief: guest access is off unless an admin enables it). */
export const setGuestAccess = action("setGuestAccess", async (assemblyId: string, enabled: boolean) => {
  const ctx = await loadAssembly(assemblyId);
  if (!ctx.isAdmin) throw new UserError("forbidden");
  assertStatus(ctx, "draft", "open");
  await db.update(s.assembly).set({ guestAccess: enabled }).where(eq(s.assembly.id, assemblyId));
  await audit(ctx.user.id, assemblyId, "assembly.guestAccess", { enabled });
});

export const addCommitteeMember = action("addCommitteeMember", async (assemblyId: string, form: FormData) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft");
  const userId = z.string().min(1).parse(form.get("userId"));
  const picked = z.enum([...SIGNER_ROLES, "none"]).parse(form.get("role") ?? "none");
  const role = picked === "none" ? null : picked;
  if (ctx.committee.some((c) => c.userId === userId)) throw new UserError("alreadyInCommittee");
  if (role && !missingSignerRoles(ctx.committee).includes(role)) throw new UserError("roleTaken");
  if (!(await db.query.user.findFirst({ where: eq(s.user.id, userId), columns: { id: true } }))) {
    throw new UserError("notFound");
  }
  const [{ last }] = await db
    .select({ last: max(s.committeeMember.position) })
    .from(s.committeeMember)
    .where(eq(s.committeeMember.assemblyId, assemblyId));
  await db.insert(s.committeeMember).values({ assemblyId, userId, role, position: (last ?? 0) + 1 });
  await audit(ctx.user.id, assemblyId, "committee.add", { userId, role });
});

export const removeCommitteeMember = action("removeCommitteeMember", async (assemblyId: string, userId: string) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft");
  await db
    .delete(s.committeeMember)
    .where(and(eq(s.committeeMember.assemblyId, assemblyId), eq(s.committeeMember.userId, userId)));
  await audit(ctx.user.id, assemblyId, "committee.remove", { userId });
});

const itemSchema = z.object({ title: z.string().trim().min(1).max(300), description: z.string().trim().max(5000).optional() });

export const addAgendaItem = action("addAgendaItem", async (assemblyId: string, form: FormData) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft", "open");
  const d = itemSchema.parse(Object.fromEntries(form));
  const [{ last }] = await db
    .select({ last: max(s.agendaItem.position) })
    .from(s.agendaItem)
    .where(eq(s.agendaItem.assemblyId, assemblyId));
  await db.insert(s.agendaItem).values({ assemblyId, position: (last ?? 0) + 1, title: d.title, description: d.description || null });
  await audit(ctx.user.id, assemblyId, "agenda.add", d);
});

export const deleteAgendaItem = action("deleteAgendaItem", async (assemblyId: string, itemId: string) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft", "open");
  const item = await db.query.agendaItem.findFirst({
    where: and(eq(s.agendaItem.id, z.uuid().parse(itemId)), eq(s.agendaItem.assemblyId, assemblyId)),
  });
  if (!item) throw new UserError("notFound");
  const used = await db.query.question.findFirst({
    where: and(eq(s.question.agendaItemId, itemId), ne(s.question.status, "draft")),
  });
  if (used) throw new UserError("wrongStatus");
  await db.transaction(async (tx) => {
    await tx.delete(s.question).where(eq(s.question.agendaItemId, itemId));
    await tx.delete(s.agendaItem).where(eq(s.agendaItem.id, itemId));
  });
  await audit(ctx.user.id, assemblyId, "agenda.delete", { itemId, title: item.title });
});

const questionSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  kind: z.enum(["motion", "election"]),
  options: z.string().max(10_000).optional(),
  maxChoices: z.coerce.number().int().min(1).max(50).default(1),
  majorityBase: z.enum(["votes_cast", "present", "members"]),
  majorityFraction: z.enum(["half", "two_thirds"]),
  resultsVisibility: z.enum(["public", "restricted"]),
  ballot: z.enum(["secret", "public"]),
});

export const addQuestion = action("addQuestion", async (assemblyId: string, itemId: string, form: FormData) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft", "open");
  const item = await db.query.agendaItem.findFirst({
    where: and(eq(s.agendaItem.id, z.uuid().parse(itemId)), eq(s.agendaItem.assemblyId, assemblyId)),
  });
  if (!item) throw new UserError("notFound");
  const { ballot, ...d } = questionSchema.parse(Object.fromEntries(form));
  // Motion options are fixed; index 0 ("Za") is what the majority rule counts.
  const options =
    d.kind === "motion"
      ? ["Za", "Protiv", "Suzdržan"]
      : [...new Set((d.options ?? "").split("\n").map((o) => o.trim()).filter(Boolean))];
  if (options.length < 2 || options.length > 50) throw new UserError("needOptions");
  const maxChoices = d.kind === "motion" ? 1 : Math.min(d.maxChoices, options.length);
  const [{ last }] = await db
    .select({ last: max(s.question.position) })
    .from(s.question)
    .where(eq(s.question.agendaItemId, itemId));
  await db
    .insert(s.question)
    .values({ ...d, secret: ballot === "secret", agendaItemId: itemId, position: (last ?? 0) + 1, options, maxChoices });
  await audit(ctx.user.id, assemblyId, "question.add", { itemId, text: d.text, ballot });
});

export const deleteQuestion = action("deleteQuestion", async (questionId: string) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertManager(ctx);
  if (question.status !== "draft") throw new UserError("wrongStatus");
  await db.delete(s.question).where(eq(s.question.id, questionId));
  await audit(ctx.user.id, ctx.assembly.id, "question.delete", { questionId, text: question.text });
});

const TYPE_ACCUSATIVE = { redovna: "redovnu", izborna: "izbornu", izvanredna: "izvanrednu" } as const;

/** The formal convening: date, place (video call) and proposed agenda to every member, by the statut's deadline. */
export const sendInvitations = action("sendInvitations", async (assemblyId: string) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft");
  const a = ctx.assembly;
  if (!a.scheduledAt) throw new UserError("scheduleFirst");
  if (a.scheduledAt.getTime() - Date.now() < statut.noticeDays * 86_400_000) throw new UserError("noticeTooShort");
  const items = await db.query.agendaItem.findMany({ where: eq(s.agendaItem.assemblyId, assemblyId), orderBy: s.agendaItem.position });
  if (!items.length) throw new UserError("agendaFirst");
  const link = `${process.env.BETTER_AUTH_URL ?? ""}/?code=${a.joinCode}`;
  const when = a.scheduledAt.toLocaleString("hr-HR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Zagreb" });
  const agenda = items.map((it, i) => `${i + 1}. ${it.title}`).join("\n");
  const text = [
    statut.name,
    "",
    `Pozivamo vas na ${TYPE_ACCUSATIVE[a.type]} sjednicu Skupštine „${a.title}”, ${when}.`,
    a.videoUrl ? `Sjednica se održava elektroničkim putem, uz videovezu: ${a.videoUrl}` : "Sjednica se održava elektroničkim putem.",
    `Glasovanje: ${link} (kod: ${a.joinCode})`,
    "",
    "Prijedlog dnevnog reda:",
    agenda,
    "",
    `You are invited to the assembly "${a.title}", ${when}.${a.videoUrl ? ` Video call: ${a.videoUrl}.` : ""} Voting: ${link} (code: ${a.joinCode}).`,
  ].join("\n");
  let sent = 0;
  let failed = 0;
  for (const m of await currentMembersWithEmail()) {
    try {
      if (await sendMail({ kind: "invitation", to: m.email!, subject: `Poziv / Invitation: ${a.title}`, text })) sent++;
    } catch {
      failed++; // sendMail logged the reason
    }
  }
  if (sent) await db.update(s.assembly).set({ invitedAt: new Date() }).where(eq(s.assembly.id, assemblyId));
  await audit(ctx.user.id, assemblyId, "assembly.invitations", { sent, failed });
  return { sent, failed };
});

export const openAssembly = action("openAssembly", async (assemblyId: string) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "draft");
  const a = ctx.assembly;
  if (!a.statutConfirmedAt) throw new UserError("statutNotConfirmed");
  if (statut.videoRequired && !a.videoUrl) throw new UserError("videoRequired");
  if (ctx.committee.length < a.threshold) throw new UserError("committeeTooSmall");
  if (missingSignerRoles(ctx.committee).length) throw new UserError("signerRolesMissing");
  const keysMissing = ctx.committee.some((c) => !c.encPublicKey || (a.sealMethod === "own_keys" && !c.signPublicKey));
  if (keysMissing) throw new UserError("committeeKeysMissing");
  await db.update(s.assembly).set({ status: "open" }).where(and(eq(s.assembly.id, assemblyId), eq(s.assembly.status, "draft")));
  await audit(ctx.user.id, assemblyId, "assembly.open");
});

export const openQuestion = action("openQuestion", async (questionId: string) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertManager(ctx);
  assertStatus(ctx, "open");
  if (question.status !== "draft") throw new UserError("wrongStatus");
  const p = await presence(ctx.assembly.id, ctx.assembly.quorumPercent);
  if (!p.quorumMet) throw new UserError("noQuorum");
  await db.transaction(async (tx) => {
    // One question at a time; the row lock on the assembly serialises concurrent opens.
    await tx.select({ id: s.assembly.id }).from(s.assembly).where(eq(s.assembly.id, ctx.assembly.id)).for("update");
    const open = await tx
      .select({ id: s.question.id })
      .from(s.question)
      .innerJoin(s.agendaItem, eq(s.agendaItem.id, s.question.agendaItemId))
      .where(and(eq(s.agendaItem.assemblyId, ctx.assembly.id), eq(s.question.status, "open")));
    if (open.length) throw new UserError("anotherQuestionOpen");
    await tx
      .update(s.question)
      .set({ status: "open", openedAt: new Date(), presentAtOpen: p.present, eligibleAtOpen: p.eligible })
      .where(eq(s.question.id, questionId));
  });
  await audit(ctx.user.id, ctx.assembly.id, "question.open", { questionId, present: p.present, eligible: p.eligible });
  logger.info("voting opened", {
    questionId,
    assemblyId: ctx.assembly.id,
    present: p.present,
    eligible: p.eligible,
    ballot: question.secret ? "secret" : "public",
    kind: question.kind,
  });
});

export const closeQuestion = action("closeQuestion", async (questionId: string) => {
  const { question, ctx } = await loadQuestion(questionId);
  assertManager(ctx);
  if (question.status !== "open") throw new UserError("wrongStatus");
  await db
    .update(s.question)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(s.question.id, questionId), eq(s.question.status, "open")));
  await audit(ctx.user.id, ctx.assembly.id, "question.close", { questionId });
});

export const closeAssembly = action("closeAssembly", async (assemblyId: string) => {
  const ctx = await manager(assemblyId);
  assertStatus(ctx, "open");
  const open = await db
    .select({ id: s.question.id })
    .from(s.question)
    .innerJoin(s.agendaItem, eq(s.agendaItem.id, s.question.agendaItemId))
    .where(and(eq(s.agendaItem.assemblyId, assemblyId), eq(s.question.status, "open")));
  if (open.length) throw new UserError("anotherQuestionOpen");
  await db.update(s.assembly).set({ status: "closed" }).where(eq(s.assembly.id, assemblyId));
  await audit(ctx.user.id, assemblyId, "assembly.close");
});

export const removeGuest = action("removeGuest", async (assemblyId: string, userId: string) => {
  const ctx = await manager(assemblyId);
  await db
    .update(s.attendance)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(s.attendance.assemblyId, assemblyId),
        eq(s.attendance.userId, userId),
        eq(s.attendance.isGuest, true),
        isNull(s.attendance.removedAt),
      ),
    );
  await audit(ctx.user.id, assemblyId, "attendance.removeGuest", { userId });
});

/** Host or committee: freezes the minutes once every question that was voted on is published. */
export const generateZapisnik = action("generateZapisnik", async (assemblyId: string) => {
  const ctx = await loadAssembly(assemblyId);
  if (!ctx.isManager && !ctx.isCommittee) throw new UserError("forbidden");
  assertStatus(ctx, "closed");
  const pending = await db
    .select({ id: s.question.id })
    .from(s.question)
    .innerJoin(s.agendaItem, eq(s.agendaItem.id, s.question.agendaItemId))
    .where(and(eq(s.agendaItem.assemblyId, assemblyId), inArray(s.question.status, ["open", "closed", "counted"])));
  if (pending.length) throw new UserError("resultsPending");
  if (await db.query.seal.findFirst({ where: eq(s.seal.assemblyId, assemblyId), columns: { assemblyId: true } })) {
    throw new UserError("zapisnikExists");
  }
  const pdf = await renderZapisnik(assemblyId);
  await db
    .insert(s.seal)
    .values({ assemblyId, pdf, pdfSha256: await sha256Hex(new Uint8Array(pdf)) })
    .onConflictDoNothing();
  await audit(ctx.user.id, assemblyId, "seal.generate");
});

