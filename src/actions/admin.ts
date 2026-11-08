"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { audit, requireAdmin } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { action, UserError } from "@/lib/errors";
import { getLogger } from "@logtape/logtape";
import { parseMembers } from "@/lib/members";
import { statut } from "@/lib/statut";
import { fromZagrebLocal } from "@/lib/time";

const logger = getLogger(["e-skupstina", "admin"]);

export const importMembers = action("importMembers", async (csv: string) => {
  const admin = await requireAdmin();
  const { members, errors } = parseMembers(z.string().max(5_000_000).parse(csv), statut.memberCategories);
  if (members.length) {
    // Upsert by OIB; members missing from the file are left untouched (set datum_prestanka instead of deleting).
    await db
      .insert(s.member)
      .values(members)
      .onConflictDoUpdate({
        target: s.member.oib,
        set: {
          fullName: sql`excluded.full_name`,
          dateOfBirth: sql`excluded.date_of_birth`,
          email: sql`excluded.email`,
          category: sql`excluded.category`,
          joinedAt: sql`excluded.joined_at`,
          leftAt: sql`excluded.left_at`,
          votingRight: sql`excluded.voting_right`,
        },
      });
  }
  await audit(admin.id, null, "members.import", { imported: members.length, errors: errors.length });
  const voting = members.filter((m) => m.votingRight).length;
  logger.info("member list imported", { imported: members.length, voting, nonVoting: members.length - voting, rejected: errors.length });
  for (const e of errors) logger.warn("member import: line rejected", { line: e.line, reason: e.message });
  return { imported: members.length, errors };
});

export const setUserRole = action("setUserRole", async (userId: string, role: "admin" | "user") => {
  const admin = await requireAdmin();
  z.enum(["admin", "user"]).parse(role);
  if (userId === admin.id) throw new UserError("cannotChangeOwnRole");
  await db.update(s.user).set({ role }).where(eq(s.user.id, z.string().parse(userId)));
  await audit(admin.id, null, "user.role", { userId, role });
});

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 8 characters from 31 unambiguous symbols (~40 bits); unbiased via rejection sampling. */
function joinCode() {
  let code = "";
  while (code.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && code.length < 8) code += ALPHABET[b % 31];
    }
  }
  return code;
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["redovna", "izborna", "izvanredna"]),
  scheduledAt: z.string().optional(),
  hostId: z.string().min(1),
});

export const createAssembly = action("createAssembly", async (form: FormData) => {
  const admin = await requireAdmin();
  const data = createSchema.parse(Object.fromEntries(form));
  const host = await db.query.user.findFirst({ where: eq(s.user.id, data.hostId), columns: { id: true } });
  if (!host) throw new UserError("notFound");
  const [row] = await db
    .insert(s.assembly)
    .values({
      title: data.title,
      type: data.type,
      scheduledAt: data.scheduledAt ? fromZagrebLocal(data.scheduledAt) : null,
      hostId: data.hostId,
      quorumPercent: statut.quorumPercent,
      joinCode: joinCode(),
    })
    .returning({ id: s.assembly.id });
  await audit(admin.id, row.id, "assembly.create", data);
  return row.id;
});
