// End-to-end flow against a real Postgres, calling the server actions as different users.
// Run: DATABASE_URL=postgres://eskupstina:eskupstina@localhost:5432/eskupstina_test bun test tests
// The database is wiped and migrated first, so it must be a *_test database.
import { expect, mock, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Result } from "@/lib/errors";
import { signPdf } from "./pdf-signer";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("_test")) throw new Error("Refusing to wipe a non-test database; point DATABASE_URL at a *_test database.");

const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`drop schema if exists drizzle cascade`;
await sql`drop schema public cascade`;
await sql`create schema public`;
await migrate(drizzle(sql), { migrationsFolder: "drizzle" });

// Bun loads .env into tests: never mail real people. Only a local catcher (Mailpit) may receive; otherwise mails print.
if (process.env.SMTP_URL && !["localhost", "127.0.0.1"].includes(new URL(process.env.SMTP_URL).hostname)) {
  delete process.env.SMTP_URL;
}

// Strict rules (video link, member categories, signers) so the flow exercises every statut check.
process.env.STATUT_FILE = new URL("./statut.test.json", import.meta.url).pathname;

let current: Record<string, unknown> | null = null;
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
const { auth } = await import("@/lib/auth");
spyOn(auth.api, "getSession").mockImplementation((async () => (current ? { user: current, session: {} } : null)) as never);

const admin = await import("@/actions/admin");
const manage = await import("@/actions/manage");
const participant = await import("@/actions/participant");
const committee = await import("@/actions/committee");
const bc = await import("@/lib/ballot-crypto");
const { db } = await import("@/lib/db");
const s = await import("@/lib/db/schema");
const { and, asc, eq } = await import("drizzle-orm");
const { toZagrebLocal } = await import("@/lib/time");

type U = { id: string; name: string; email: string; oib: string | null; role: string };
const users: Record<"ana" | "ivo" | "marko" | "gost", U> = {
  ana: { id: "u-ana", name: "Ana Horvat", email: "ana@example.hr", oib: "11111111119", role: "admin" },
  ivo: { id: "u-ivo", name: "Ivo Kovač", email: "ivo@example.hr", oib: "22222222226", role: "user" },
  marko: { id: "u-marko", name: "Marko Marić", email: "marko@example.hr", oib: "33333333335", role: "user" },
  gost: { id: "u-gost", name: "Gost Gostić", email: "gost@example.hr", oib: null, role: "user" },
};
await db.insert(s.user).values(Object.values(users).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, emailVerified: true })));
// Members logged in with Certilia; the guest only has an email-code login (no account row).
await db.insert(s.account).values(
  [users.ana, users.ivo, users.marko].map((u) => ({ id: `acc-${u.id}`, accountId: u.oib!, providerId: "certilia", userId: u.id })),
);

const as = (u: U) => {
  current = { ...u, emailVerified: true, image: null, createdAt: new Date(), updatedAt: new Date() };
};
const ok = <T>(r: Result<T>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.data;
};
const fails = async (p: Promise<Result<unknown>>, error: string) => expect(await p).toEqual({ ok: false, error });
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const assemblyRow = async (id: string) => (await db.select().from(s.assembly).where(eq(s.assembly.id, id)))[0];

test("an assembly from invitation to sealed minutes (own keys)", async () => {
  as(users.ivo);
  await fails(admin.importMembers("oib;ime_prezime\n11111111119;X"), "forbidden");

  as(users.ana);
  const imported = ok(
    await admin.importMembers(
      "oib;ime_prezime;email;kategorija;datum_prestanka\n" +
        "11111111119;Ana Horvat;ana@example.hr;redovni;\n" +
        "22222222226;Ivo Kovač;ivo@example.hr;redovni;\n" +
        "33333333335;Marko Marić;marko@example.hr;redovni;\n" +
        "44444444446;Bivši Član;;redovni;1.1.2020.\n" +
        "55555555551;Petra Perić;petra@example.hr;podupirući;\n",
    ),
  );
  expect(imported).toEqual({ imported: 5, errors: [] });
  // statut.test.json: supporting members (podupirući) have no vote.
  expect((await db.select().from(s.member).where(eq(s.member.oib, "55555555551")))[0].votingRight).toBe(false);

  const id = ok(
    await admin.createAssembly(form({ title: "Redovna 2026", type: "redovna", hostId: users.ana.id, scheduledAt: "2026-12-01T18:00" })),
  );
  expect((await assemblyRow(id)).scheduledAt?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
  const settings = {
    title: "Redovna 2026",
    type: "redovna",
    scheduledAt: "2026-12-01T18:00",
    quorumPercent: "50",
    threshold: "2",
    sealMethod: "own_keys",
    statutConfirmed: "on",
  };
  ok(await manage.updateSettings(id, form(settings)));
  // The statut names who signs the minutes: chair and recorder, one each.
  ok(await manage.addCommitteeMember(id, form({ userId: users.ana.id, role: "chair" })));
  await fails(manage.addCommitteeMember(id, form({ userId: users.marko.id, role: "chair" })), "roleTaken");
  ok(await manage.addCommitteeMember(id, form({ userId: users.ivo.id })));
  await fails(manage.openAssembly(id), "videoRequired");
  await fails(manage.updateSettings(id, form({ ...settings, videoUrl: "javascript:alert(1)" })), "invalidInput");
  ok(await manage.updateSettings(id, form({ ...settings, videoUrl: "https://meet.jit.si/udruga-2026" })));
  await fails(manage.openAssembly(id), "signerRolesMissing");
  ok(await manage.removeCommitteeMember(id, users.ivo.id));
  ok(await manage.addCommitteeMember(id, form({ userId: users.ivo.id, role: "recorder" })));
  await fails(manage.openAssembly(id), "committeeKeysMissing");
  await fails(manage.sendInvitations(id), "agendaFirst");

  // Key ceremony: each committee member's "browser" makes keys and uploads only the public half.
  const keys: Record<string, import("@/lib/ballot-crypto").KeyFile> = {};
  for (const u of [users.ana, users.ivo]) {
    as(u);
    const k = await bc.generateCommitteeKeys(id, u.id, true);
    await fails(committee.registerKeys(id, k.file.enc, k.signPublic), "privateKeyUploaded");
    ok(await committee.registerKeys(id, k.encPublic, k.signPublic));
    keys[u.id] = k.file;
  }

  as(users.ana);
  ok(await manage.addAgendaItem(id, form({ title: "Financijsko izvješće za 2025." })));
  const [item] = await db.select().from(s.agendaItem).where(eq(s.agendaItem.assemblyId, id));
  const base = { majorityBase: "votes_cast", majorityFraction: "half" };
  ok(
    await manage.addQuestion(id, item.id, form({ ...base, text: "Usvaja se izvješće.", kind: "motion", resultsVisibility: "public", ballot: "public" })),
  );
  ok(
    await manage.addQuestion(
      id,
      item.id,
      form({
        ...base,
        text: "Izbor predsjednika",
        kind: "election",
        options: "Ana\nIvo\nMarko",
        maxChoices: "1",
        resultsVisibility: "restricted",
        ballot: "secret",
      }),
    ),
  );
  // Invitations go to every current member with an email, the supporting member included.
  expect(ok(await manage.sendInvitations(id))).toEqual({ sent: 4, failed: 0 });
  expect((await assemblyRow(id)).invitedAt).not.toBeNull();
  ok(await manage.openAssembly(id));
  const { joinCode } = await assemblyRow(id);

  // Guests only with admin-enabled access, and never vote.
  as(users.gost);
  await fails(participant.joinAssembly(joinCode), "guestAccessDisabled");
  as(users.ivo);
  await fails(manage.setGuestAccess(id, true), "forbidden");
  as(users.ana);
  ok(await manage.setGuestAccess(id, true));
  as(users.gost);
  ok(await participant.joinAssembly(joinCode.toLowerCase()));
  for (const u of [users.ana, users.ivo, users.marko]) {
    as(u);
    ok(await participant.joinAssembly(joinCode));
  }

  const [motion, election] = await db
    .select()
    .from(s.question)
    .where(eq(s.question.agendaItemId, item.id))
    .orderBy(asc(s.question.position));
  const pubs = (
    await db.select().from(s.committeeMember).where(eq(s.committeeMember.assemblyId, id)).orderBy(asc(s.committeeMember.position))
  ).map((c) => c.encPublicKey!);
  const vote = async (u: U, questionId: string, choices: number[]) => {
    as(u);
    return participant.castVote(questionId, await bc.encryptBallot(questionId, choices, pubs, 2));
  };

  as(users.ana);
  ok(await manage.openQuestion(motion.id));
  await fails(manage.openQuestion(election.id), "anotherQuestionOpen");
  const receipts = {
    ana: ok(await vote(users.ana, motion.id, [0])),
    ivo: ok(await vote(users.ivo, motion.id, [0])),
  };
  await fails(vote(users.ana, motion.id, [1]), "alreadyVoted");
  await fails(vote(users.gost, motion.id, [0]), "notEligible");
  as(users.ivo);
  await fails(manage.closeQuestion(motion.id), "forbidden");
  as(users.ana);
  ok(await manage.closeQuestion(motion.id));
  await fails(vote(users.marko, motion.id, [1]), "votingClosed");
  expect((await db.select().from(s.question).where(eq(s.question.id, motion.id)))[0]).toMatchObject({ presentAtOpen: 3, eligibleAtOpen: 3 });

  as(users.ana);
  ok(await manage.openQuestion(election.id));
  for (const [u, c] of [[users.ana, [0]], [users.ivo, [0]], [users.marko, [2]]] as const) ok(await vote(u, election.id, [...c]));
  as(users.ana);
  ok(await manage.closeQuestion(election.id));

  // Counting: both committee members submit shares; the server tallies; each "browser" re-counts and confirms.
  as(users.marko);
  await fails(committee.getQuestionData(motion.id), "forbidden");
  for (const q of [motion, election]) {
    for (const u of [users.ana, users.ivo]) {
      as(u);
      const d = ok(await committee.getQuestionData(q.id));
      expect(d.submissions).toEqual([]);
      ok(await committee.submitShares(q.id, await bc.unwrapMyShares(q.id, d.ballots, d.myIndex, keys[u.id].enc)));
    }
    as(users.ivo);
    await fails(committee.confirmResult(q.id, { counts: [9, 9, 9], valid: 27, invalid: 0 }), "resultMismatch");
    for (const u of [users.ana, users.ivo]) {
      as(u);
      const d = ok(await committee.getQuestionData(q.id));
      ok(await committee.confirmResult(q.id, await bc.tallyBallots(d.question, d.ballots, d.submissions)));
    }
  }
  const results = await db.select().from(s.result);
  // Public vote: names with choices. Secret vote: no names anywhere.
  expect(results.find((r) => r.questionId === motion.id)).toMatchObject({
    counts: [2, 0, 0],
    valid: 2,
    invalid: 0,
    adopted: true,
    roll: [
      { name: "Ana Horvat", choices: [0] },
      { name: "Ivo Kovač", choices: [0] },
    ],
  });
  expect(results.find((r) => r.questionId === election.id)).toMatchObject({ counts: [2, 0, 1], valid: 3, adopted: null, roll: null });
  expect((await db.select().from(s.ballot).where(eq(s.ballot.questionId, election.id))).map((b) => b.memberId)).toEqual([null, null, null]);
  expect(ok(await participant.lookupReceipt(receipts.ivo))).toMatchObject({ status: "published", question: "Usvaja se izvješće." });

  // Close, freeze the minutes, sign with own keys; the second signature seals and mails.
  as(users.ana);
  await fails(manage.generateZapisnik(id), "wrongStatus");
  ok(await manage.closeAssembly(id));
  ok(await manage.generateZapisnik(id));
  const [sealRow] = await db.select().from(s.seal).where(eq(s.seal.assemblyId, id));
  expect(sealRow.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await Bun.write(`${process.env.PDF_OUT ?? "/tmp"}/zapisnik-own-keys.pdf`, sealRow.pdf);
  as(users.ana);
  await fails(committee.submitOwnSignature(id, await bc.signBytes(keys[users.ivo.id].sign!, new Uint8Array(sealRow.pdf))), "badSignature");
  for (const u of [users.ana, users.ivo]) {
    as(u);
    ok(await committee.submitOwnSignature(id, await bc.signBytes(keys[u.id].sign!, new Uint8Array(sealRow.pdf))));
  }
  expect((await assemblyRow(id)).status).toBe("sealed");
  const info = ok(await participant.lookupSeal(sealRow.pdfSha256))!;
  expect(info.signatures.map((x) => x.name).sort()).toEqual(["Ana Horvat", "Ivo Kovač"]);
  for (const x of info.signatures) expect(await bc.verifyBytes(x.publicKeyJwk!, new Uint8Array(sealRow.pdf), x.signature!)).toBe(true);
  const [mailed] = await db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.assemblyId, id), eq(s.auditLog.action, "seal.mailed")));
  // Voters ana, ivo, marko (+ host ana).
  expect(mailed.detail).toEqual({ sent: 3, failed: [] });
});

test("Certilia sealing: each signer appends a signature that must carry their OIB", async () => {
  as(users.ana);
  const id = ok(await admin.createAssembly(form({ title: "Izvanredna", type: "izvanredna", hostId: users.ana.id })));
  await fails(manage.sendInvitations(id), "scheduleFirst");
  const settings = {
    title: "Izvanredna",
    type: "izvanredna",
    quorumPercent: "0",
    threshold: "2",
    sealMethod: "certilia_app",
    statutConfirmed: "on",
    videoUrl: "https://meet.jit.si/udruga-izvanredna",
  };
  // Tomorrow is inside the statut's 8-day notice period.
  ok(await manage.updateSettings(id, form({ ...settings, scheduledAt: toZagrebLocal(new Date(Date.now() + 86_400_000)) })));
  await fails(manage.sendInvitations(id), "noticeTooShort");
  const roles: Record<string, string> = { [users.ana.id]: "chair", [users.ivo.id]: "recorder", [users.marko.id]: "none" };
  for (const u of [users.ana, users.ivo, users.marko]) {
    as(users.ana);
    ok(await manage.addCommitteeMember(id, form({ userId: u.id, role: roles[u.id] })));
    as(u);
    const k = await bc.generateCommitteeKeys(id, u.id, false);
    ok(await committee.registerKeys(id, k.encPublic, null));
  }
  as(users.ana);
  ok(await manage.openAssembly(id));
  ok(await manage.closeAssembly(id));
  ok(await manage.generateZapisnik(id));
  const original = new Uint8Array((await db.select().from(s.seal).where(eq(s.seal.assemblyId, id)))[0].pdf);
  const upload = (pdf: Uint8Array) => {
    const f = new FormData();
    f.set("pdf", new File([pdf as BlobPart], "zapisnik.pdf", { type: "application/pdf" }));
    return committee.submitCertiliaPdf(id, f);
  };

  await fails(upload(await signPdf(original, `PNOHR-${users.ivo.oib}`, "Ivo Kovač")), "signerMismatch");
  const byAna = await signPdf(original, `PNOHR-${users.ana.oib}`, "Ana Horvat");
  ok(await upload(byAna));
  await fails(upload(byAna), "alreadySigned");
  // Two signatures reach k = 2, but the recorder (Ivo) has not signed yet, so nothing is sealed.
  as(users.marko);
  const byMarko = await signPdf(byAna, `PNOHR-${users.marko.oib}`, "Marko Marić");
  ok(await upload(byMarko));
  expect((await assemblyRow(id)).status).toBe("closed");
  as(users.ivo);
  await fails(upload(await signPdf(original, `PNOHR-${users.ivo.oib}`, "Ivo Kovač")), "pdfModified");
  ok(await upload(await signPdf(byMarko, `PNOHR-${users.ivo.oib}`, "Ivo Kovač")));
  expect((await assemblyRow(id)).status).toBe("sealed");
  const names = (await db.select().from(s.sealSignature).where(eq(s.sealSignature.assemblyId, id))).map((x) => x.signerName).sort();
  expect(names).toEqual(["Ana Horvat", "Ivo Kovač", "Marko Marić"]);
});
