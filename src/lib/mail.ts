import * as Sentry from "@sentry/nextjs";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { getLogger } from "@logtape/logtape";
import { errorMessage } from "./errors";

const logger = getLogger(["e-skupstina", "mail"]);

let transport: ReturnType<typeof nodemailer.createTransport> | null | undefined;

/** Created on first use, so a bad SMTP_URL breaks only sending mail, not every page. */
function getTransport() {
  if (transport !== undefined) return transport;
  const url = process.env.SMTP_URL;
  // nodemailer treats anything else as an already-built transport and fails with an unreadable error.
  if (url && !/^smtps?:\/\//i.test(url)) {
    logger.error("SMTP_URL must start with smtp:// or smtps://");
    throw new Error("SMTP_URL must start with smtp:// or smtps://");
  }
  transport = url ? nodemailer.createTransport(url) : null;
  logger.info(transport ? "mail transport ready" : "mail transport not configured", { host: url ? new URL(url).hostname : null });
  return transport;
}

/** `kind` is for logs only (the subject can hold a sign-in code, and addresses are personal data). */
export type Message = { to: string; subject: string; text: string; attachments?: Mail.Attachment[]; kind: string };

/** Returns false when the address is a placeholder (Certilia login without an email). */
export async function sendMail({ kind, ...msg }: Message) {
  const domain = msg.to.split("@")[1] ?? "?";
  if (msg.to.endsWith(".invalid")) {
    logger.debug("mail skipped: placeholder address", { kind });
    return false;
  }
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_URL is not configured");
    console.info(`[mail → ${msg.to}] ${msg.subject}\n${msg.text}`);
    return true;
  }
  return Sentry.startSpan({ name: `mail ${kind}`, op: "mail.send", attributes: { kind, domain } }, async () => {
    try {
      const info = await t.sendMail({ from: process.env.MAIL_FROM, ...msg });
      logger.info("mail sent", { kind, domain, attachments: msg.attachments?.length ?? 0, response: info.response?.slice(0, 80) });
      return true;
    } catch (e) {
      logger.error("mail failed", { kind, domain, error: errorMessage(e) });
      throw e;
    }
  });
}
