import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyForm } from "./verify-form";

export default async function VerifyPage({ params, searchParams }: PageProps<"/[locale]/verify">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { receipt } = await searchParams;
  const t = await getTranslations("verify");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <VerifyForm receipt={typeof receipt === "string" ? receipt : undefined} />
    </div>
  );
}
