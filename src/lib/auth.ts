import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { genericOAuth, okta, type GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { and, eq, inArray, sql } from "drizzle-orm";
import { refreshAvatar } from "./avatar";
import { certiliaUserInfo } from "./certilia";
import { db } from "./db";
import * as schema from "./db/schema";
import { sendMail } from "./mail";
import { isValidOib } from "./members";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "auth"]);

/** Logins that prove identity strongly enough to vote. Email-code logins are guests and can only watch. */
export const MEMBER_PROVIDERS = ["certilia", "okta"];

const providers: GenericOAuthConfig[] = [];

/** Certilia returns the verified OIB as the "pin" claim (its discovery document lists "pin", the portal calls it "OIB/PIN").
 * shortcut: claim name not yet seen in a real login; if login fails with this error, log the profile and check. */
function certiliaOib(profile: Record<string, unknown>) {
  const oib = String(profile.pin ?? "");
  if (!isValidOib(oib)) {
    // Claim names only, never values: tells us which field the OIB is in if Certilia renames it.
    logger.warn("Certilia profile has no valid OIB", { claims: Object.keys(profile).sort().join(","), hasPin: "pin" in profile });
    throw new APIError("UNAUTHORIZED", { message: "Certilia profile has no valid OIB" });
  }
  return oib;
}

const certiliaDiscovery = process.env.CERTILIA_DISCOVERY_URL;
if (certiliaDiscovery) {
  providers.push({
    providerId: "certilia",
    discoveryUrl: certiliaDiscovery,
    clientId: process.env.CERTILIA_CLIENT_ID ?? "",
    clientSecret: process.env.CERTILIA_CLIENT_SECRET ?? "",
    scopes: (process.env.CERTILIA_SCOPES ?? "openid profile email").split(/\s+/),
    requireIdTokenVerification: true,
    overrideUserInfo: true,
    // Always read Certilia's userinfo endpoint. Better Auth would otherwise use only the ID token whenever it has an
    // email, and the OIB may be released only through userinfo. Better Auth still checks `sub` against the ID token.
    getUserInfo: async (tokens) => {
      const r = await certiliaUserInfo(tokens.accessToken);
      if (!r) logger.warn("Certilia userinfo unavailable");
      return r && { ...r.info, emailVerified: r.info.email_verified === true || r.info.email_verified === "true" };
    },
    // The OIB becomes the account's subject (account.account_id). Better Auth writes it from the verified
    // provider response only; user-editable profile fields could not be trusted for voting rights.
    accountSubject: ({ profile }) => certiliaOib(profile),
    mapProfileToUser: (p) => {
      const oib = certiliaOib(p);
      const name = p.name || [p.given_name, p.family_name].filter(Boolean).join(" ") || oib;
      // Certilia may not return an email; .invalid addresses are never mailed.
      return { name, email: p.email || `${oib}@certilia.invalid` };
    },
  });
}

if (process.env.OKTA_ISSUER) {
  providers.push({
    ...okta({
      issuer: process.env.OKTA_ISSUER,
      clientId: process.env.OKTA_CLIENT_ID ?? "",
      clientSecret: process.env.OKTA_CLIENT_SECRET ?? "",
    }),
    overrideUserInfo: true,
  });
}

/** With OKTA_ADMIN_GROUP set, the ID token's "groups" claim decides the admin role on every Okta login.
 * (Better Auth ignores `role` from profile mapping on purpose, so this runs after the callback.) */
async function syncOktaRole(userId: string) {
  const adminGroup = process.env.OKTA_ADMIN_GROUP;
  if (!adminGroup) return;
  const acc = await db.query.account.findFirst({
    where: and(eq(schema.account.userId, userId), eq(schema.account.providerId, "okta")),
    columns: { idToken: true },
  });
  if (!acc?.idToken) return;
  const claims = JSON.parse(Buffer.from(acc.idToken.split(".")[1] ?? "", "base64url").toString() || "{}");
  const role = Array.isArray(claims.groups) && claims.groups.includes(adminGroup) ? "admin" : "user";
  await db.update(schema.user).set({ role }).where(eq(schema.user.id, userId));
  logger.info("Okta role synced", { userId, role });
}

export const loginProviders = providers.map((p) => p.providerId);

export async function guestAccessOpen() {
  const row = await db.query.assembly.findFirst({
    where: and(eq(schema.assembly.guestAccess, true), inArray(schema.assembly.status, ["draft", "open"])),
    columns: { id: true },
  });
  return !!row;
}

async function hasMemberLogin(email: string) {
  const rows = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .innerJoin(schema.user, eq(schema.user.id, schema.account.userId))
    .where(and(eq(sql`lower(${schema.user.email})`, email.toLowerCase()), inArray(schema.account.providerId, MEMBER_PROVIDERS)))
    .limit(1);
  return rows.length > 0;
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
  // Better Auth's own messages go through our logger; its extra arguments can hold tokens, so they are dropped.
  logger: { level: "debug", log: (level, message) => logger[level](`Better Auth: ${message}`) },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
    },
  },
  hooks: {
    // Email-code login exists only for guests, and only while an admin has guest access on.
    before: createAuthMiddleware(async (ctx) => {
      if (!ctx.path.includes("email-otp")) return;
      const isSend = ctx.path === "/email-otp/send-verification-otp";
      if (!(isSend && ctx.body?.type === "sign-in") && ctx.path !== "/sign-in/email-otp") {
        throw new APIError("NOT_FOUND");
      }
      if (!(await guestAccessOpen())) {
        logger.warn("guest sign-in refused: guest access is off", { step: isSend ? "send-code" : "sign-in" });
        throw new APIError("FORBIDDEN", { message: "guestAccessDisabled" });
      }
      if (await hasMemberLogin(String(ctx.body?.email ?? ""))) {
        logger.warn("guest sign-in refused: address belongs to a member login", { step: isSend ? "send-code" : "sign-in" });
        throw new APIError("FORBIDDEN", { message: "useMemberLogin" });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const userId = ctx.context.newSession?.user.id;
      const isCallback = ctx.path.startsWith("/callback/");
      if (isCallback && !userId) logger.warn("sign-in failed", { provider: ctx.params?.id });
      if (!userId) return;
      const provider = isCallback ? ctx.params?.id : ctx.path === "/sign-in/email-otp" ? "email-otp" : undefined;
      if (provider) {
        logger.info("signed in", { provider, userId });
      }
      if (isCallback && ctx.params?.id === "okta") await syncOktaRole(userId);
      // Not awaited: fetching the photo must not slow down or break the sign-in.
      if (isCallback || ctx.path === "/sign-in/email-otp") void refreshAvatar(userId, isCallback ? ctx.params?.id : undefined);
    }),
  },
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;
        await sendMail({
          kind: "sign-in-code",
          to: email,
          subject: `e-Skupština: ${otp}`,
          text: `Vaš kod za prijavu / Your sign-in code: ${otp}\n\nKod vrijedi 5 minuta. / The code is valid for 5 minutes.`,
        });
      },
    }),
    genericOAuth({ config: providers }),
    nextCookies(),
  ],
});

export type SessionUser = typeof auth.$Infer.Session.user;
