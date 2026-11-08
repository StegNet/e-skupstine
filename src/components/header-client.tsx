"use client";

import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "hr" ? "en" : "hr";
  return (
    <Link href={pathname} locale={other} className="uppercase text-muted-foreground hover:text-foreground" hrefLang={other}>
      {other}
    </Link>
  );
}

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
