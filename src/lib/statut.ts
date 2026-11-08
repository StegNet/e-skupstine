// The udruga's own rules from its statut (the law leaves them to it). Read at start-up from STATUT_FILE, or
// statut.json in the working directory; see README "Statut" for what each key means.
// Server-only: pass values to client components as props.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SIGNER_ROLES = ["chair", "recorder", "verifier"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const statutSchema = z.object({
  /** Full name of the udruga, printed at the top of the zapisnik. */
  name: z.string().trim().min(1),
  /** The invitation must go out at least this many days before the session. */
  noticeDays: z.number().int().min(0),
  /** An electronic session also needs a video call (simultaneous picture and sound). */
  videoRequired: z.boolean(),
  /** Default quorum: strictly more than this % of members with voting right present. */
  quorumPercent: z.number().int().min(0).max(99),
  /** Default majority for new motions. */
  majority: z.object({ base: z.enum(["votes_cast", "present", "members"]), fraction: z.enum(["half", "two_thirds"]) }),
  /** false: voting is public (by name) unless the host marks a question secret. */
  secretBallotByDefault: z.boolean(),
  /** Member category (CSV "kategorija") -> voting right. Empty: every member votes unless pravo_glasa says otherwise. */
  memberCategories: z.record(z.string().min(1), z.boolean()),
  /** Committee roles that must sign the zapisnik; repeat a role to require several (e.g. two verifiers). */
  minutesSigners: z.array(z.enum(SIGNER_ROLES)),
});
export type Statut = z.infer<typeof statutSchema>;

const file = process.env.STATUT_FILE || path.join(process.cwd(), "statut.json");
export const statut: Statut = statutSchema.parse(JSON.parse(readFileSync(file, "utf8")));
