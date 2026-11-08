import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "@/i18n/navigation";
import { getUser } from "@/lib/assembly";
import { guestAccessOpen } from "@/lib/auth";
import { GuestForm } from "./guest-form";

export default async function GuestPage({ params, searchParams }: PageProps<"/[locale]/guest">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { code } = await searchParams;
  if (await getUser()) redirect({ href: typeof code === "string" ? `/?code=${encodeURIComponent(code)}` : "/", locale: await getLocale() });
  const t = await getTranslations("guest");
  const open = await guestAccessOpen();
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>{open ? <GuestForm code={typeof code === "string" ? code : undefined} /> : <p>{t("disabled")}</p>}</CardContent>
    </Card>
  );
}
