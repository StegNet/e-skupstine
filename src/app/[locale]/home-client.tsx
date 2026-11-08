"use client";

import { useTranslations } from "next-intl";
import { joinAssembly } from "@/actions/participant";
import { useRun } from "@/components/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function LoginButtons({ providers, callbackURL }: { providers: string[]; callbackURL: string }) {
  const t = useTranslations("home");
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {providers.map((p) => (
        <Button
          key={p}
          size="lg"
          onClick={() => authClient.signIn.social({ provider: p, callbackURL, errorCallbackURL: "/?error=signin" })}
        >
          {t(`signInWith.${p}` as "signInWith.certilia")}
        </Button>
      ))}
    </div>
  );
}

export function JoinForm({ defaultCode }: { defaultCode?: string }) {
  const t = useTranslations("home");
  const router = useRouter();
  const { run, pending } = useRun();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("code") ?? "");
        run(() => joinAssembly(code), undefined, (id) => router.push(`/a/${id}`));
      }}
    >
      <Input
        name="code"
        defaultValue={defaultCode}
        placeholder="ABCD2345"
        autoComplete="off"
        aria-label={t("code")}
        className="max-w-48 font-mono uppercase tracking-widest"
        required
      />
      <Button type="submit" disabled={pending}>{t("join")}</Button>
    </form>
  );
}
