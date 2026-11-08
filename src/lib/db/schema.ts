import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const ts = () => timestamp({ withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Popis članova (Zakon o udrugama čl. 12). Users match a member by OIB (Certilia) or email (Okta). */
export const member = pgTable("member", {
  id: uuid().primaryKey().defaultRandom(),
  oib: text().notNull().unique(),
  fullName: text().notNull(),
  dateOfBirth: date(),
  email: text(),
  category: text(),
  joinedAt: date(),
  leftAt: date(),
  votingRight: boolean().notNull().default(true),
});

export const assembly = pgTable("assembly", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  type: text({ enum: ["redovna", "izborna", "izvanredna"] }).notNull().default("redovna"),
  scheduledAt: ts(),
  /** Video call for the session; statutes often require picture and sound, not just online voting. */
  videoUrl: text(),
  /** Last time invitations were mailed; cleared when the date changes. */
  invitedAt: ts(),
  joinCode: text().notNull().unique(),
  status: text({ enum: ["draft", "open", "closed", "sealed"] }).notNull().default("draft"),
  hostId: text()
    .notNull()
    .references(() => user.id),
  guestAccess: boolean().notNull().default(false),
  statutConfirmedAt: ts(),
  quorumPercent: integer().notNull().default(50),
  threshold: integer().notNull().default(2),
  sealMethod: text({ enum: ["certilia_app", "own_keys"] }).notNull().default("certilia_app"),
  createdAt: ts().notNull().defaultNow(),
});

export const committeeMember = pgTable(
  "committee_member",
  {
    assemblyId: uuid()
      .notNull()
      .references(() => assembly.id),
    userId: text()
      .notNull()
      .references(() => user.id),
    position: integer().notNull(),
    /** Role in the minutes (statut "minutesSigners"); every member with a role must sign before the seal. */
    role: text({ enum: ["chair", "recorder", "verifier"] }),
    encPublicKey: jsonb().$type<JsonWebKey>(),
    signPublicKey: jsonb().$type<JsonWebKey>(),
  },
  (t) => [primaryKey({ columns: [t.assemblyId, t.userId] })],
);

export const agendaItem = pgTable("agenda_item", {
  id: uuid().primaryKey().defaultRandom(),
  assemblyId: uuid()
    .notNull()
    .references(() => assembly.id),
  position: integer().notNull(),
  title: text().notNull(),
  description: text(),
});

export const question = pgTable("question", {
  id: uuid().primaryKey().defaultRandom(),
  agendaItemId: uuid()
    .notNull()
    .references(() => agendaItem.id),
  position: integer().notNull(),
  text: text().notNull(),
  kind: text({ enum: ["motion", "election"] }).notNull(),
  options: jsonb().$type<string[]>().notNull(),
  maxChoices: integer().notNull().default(1),
  majorityBase: text({ enum: ["votes_cast", "present", "members"] }).notNull().default("votes_cast"),
  majorityFraction: text({ enum: ["half", "two_thirds"] }).notNull().default("half"),
  resultsVisibility: text({ enum: ["public", "restricted"] }).notNull().default("public"),
  /** Secret ballot; false = public vote, where each voter's name is published with their choice. */
  secret: boolean().notNull().default(true),
  status: text({ enum: ["draft", "open", "closed", "counted", "published"] }).notNull().default("draft"),
  presentAtOpen: integer(),
  eligibleAtOpen: integer(),
  openedAt: ts(),
  closedAt: ts(),
});

export const attendance = pgTable(
  "attendance",
  {
    assemblyId: uuid()
      .notNull()
      .references(() => assembly.id),
    userId: text()
      .notNull()
      .references(() => user.id),
    /** Set only when the user matched a member with voting right at join time. */
    memberId: uuid().references(() => member.id),
    isGuest: boolean().notNull(),
    joinedAt: ts().notNull().defaultNow(),
    lastSeenAt: ts().notNull().defaultNow(),
    removedAt: ts(),
  },
  (t) => [primaryKey({ columns: [t.assemblyId, t.userId] })],
);

/** Who voted. No link to the ballot (except ballot.memberId on public votes) and no timestamp. Keyed by member so one member cannot vote twice through two logins. */
export const participation = pgTable(
  "participation",
  {
    questionId: uuid()
      .notNull()
      .references(() => question.id),
    memberId: uuid()
      .notNull()
      .references(() => member.id),
    userId: text()
      .notNull()
      .references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.memberId] })],
);

/** Encrypted ballots, no timestamp. `bundle` is the exact JSON text the voter hashed into `receipt`. */
export const ballot = pgTable("ballot", {
  id: uuid().primaryKey().defaultRandom(),
  questionId: uuid()
    .notNull()
    .references(() => question.id),
  bundle: text().notNull(),
  receipt: text().notNull().unique(),
  /** The voter, on public (non-secret) questions only. */
  memberId: uuid().references(() => member.id),
});

export const shareSubmission = pgTable(
  "share_submission",
  {
    questionId: uuid()
      .notNull()
      .references(() => question.id),
    userId: text()
      .notNull()
      .references(() => user.id),
    shares: jsonb().$type<Record<string, string>>().notNull(),
    submittedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);

export const result = pgTable("result", {
  questionId: uuid()
    .primaryKey()
    .references(() => question.id),
  counts: jsonb().$type<number[]>().notNull(),
  valid: integer().notNull(),
  invalid: integer().notNull(),
  adopted: boolean(),
  /** Public votes: who chose what (null choices = invalid ballot), sorted by name. */
  roll: jsonb().$type<{ name: string; choices: number[] | null }[]>(),
  receiptsDigest: text().notNull(),
  countedAt: ts().notNull().defaultNow(),
});

export const resultConfirmation = pgTable(
  "result_confirmation",
  {
    questionId: uuid()
      .notNull()
      .references(() => question.id),
    userId: text()
      .notNull()
      .references(() => user.id),
    confirmedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })],
);

export const seal = pgTable("seal", {
  assemblyId: uuid()
    .primaryKey()
    .references(() => assembly.id),
  pdf: bytea().notNull(),
  pdfSha256: text().notNull().unique(),
  signedPdf: bytea(),
  signedPdfSha256: text().unique(),
  createdAt: ts().notNull().defaultNow(),
  sealedAt: ts(),
});

export const sealSignature = pgTable(
  "seal_signature",
  {
    assemblyId: uuid()
      .notNull()
      .references(() => assembly.id),
    userId: text()
      .notNull()
      .references(() => user.id),
    /** ECDSA P-256 signature (P1363, base64) over the original PDF for own_keys; null for Certilia (the signature is inside the PDF). */
    signature: text(),
    signerName: text().notNull(),
    signedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assemblyId, t.userId] })],
);

/** Profile photo (Certilia photo or Gravatar), fetched at sign-in and served by /api/avatar/[id]. */
export const avatar = pgTable("avatar", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  contentType: text().notNull(),
  data: bytea().notNull(),
  updatedAt: ts().notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial().primaryKey(),
  at: ts().notNull().defaultNow(),
  actorId: text(),
  assemblyId: uuid(),
  action: text().notNull(),
  detail: jsonb(),
});
