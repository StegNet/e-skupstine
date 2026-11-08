import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getUser, isAdmin } from "@/lib/assembly";
import { LocaleSwitcher, SignOutButton } from "./header-client";
import { UserAvatar } from "./user-avatar";

export async function Header() {
  const t = await getTranslations("nav");
  const user = await getUser();
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="text-base font-semibold">
          e-Skupština
        </Link>
        {user && isAdmin(user) && (
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            {t("admin")}
          </Link>
        )}
        <Link href="/verify" className="text-muted-foreground hover:text-foreground">
          {t("verify")}
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitcher />
          {user && (
            <>
              <span className="flex items-center gap-2 text-muted-foreground">
                <UserAvatar name={user.name} image={user.image} size="sm" />
                <span className="hidden sm:inline">{user.name}</span>
              </span>
              <SignOutButton label={t("signOut")} />
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
