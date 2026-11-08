"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function GuestForm({ code }: { code?: string }) {
  const t = useTranslations("guest");
  const te = useTranslations("errors");
  const router = useRouter();
  const [step, setStep] = useState<"details" | "otp">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (message?: string) => toast.error(message && te.has(message) ? te(message) : te("generic"));

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setBusy(false);
    if (error) return fail(error.message);
    setStep("otp");
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const otp = String(new FormData(e.currentTarget).get("otp") ?? "").trim();
    setBusy(true);
    const { error } = await authClient.signIn.emailOtp({ email, otp, name });
    setBusy(false);
    if (error) return fail(error.code === "INVALID_OTP" ? "invalidOtp" : error.message);
    router.push(code ? `/?code=${encodeURIComponent(code)}` : "/");
    router.refresh();
  }

  if (step === "otp") {
    return (
      <form onSubmit={verify} className="space-y-3">
        <p className="text-sm">{t("codeSent", { email })}</p>
        <Label htmlFor="otp">{t("code")}</Label>
        <Input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" required className="max-w-40 font-mono" />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{t("signIn")}</Button>
          <Button type="button" variant="ghost" onClick={() => setStep("details")}>
            {t("back")}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={sendCode} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      <Button type="submit" disabled={busy}>{t("sendCode")}</Button>
    </form>
  );
}
