import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { loadAssembly } from "./assembly";
import { UserError } from "./errors";

/** loadAssembly for pages: signed-out visitors go home, unknown ids 404. */
export async function pageCtx(id: string) {
  try {
    return await loadAssembly(id);
  } catch (e) {
    if (e instanceof UserError && e.message === "signInRequired") redirect({ href: "/", locale: await getLocale() });
    if (e instanceof UserError) notFound();
    throw e;
  }
}
