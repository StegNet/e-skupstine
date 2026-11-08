"use client";

import { useTranslations } from "next-intl";
import { createAssembly } from "@/actions/admin";
import { ActionForm } from "@/components/action-form";
import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";

export function CreateAssembly({ users, me }: { users: { value: string; label: string }[]; me: string }) {
  const t = useTranslations("admin");
  const tt = useTranslations("assemblyType");
  const router = useRouter();
  return (
    <ActionForm action={createAssembly} onDone={(id) => router.push(`/a/${id}/manage`)} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="title">{t("assemblyTitle")}</Label>
        <Input id="title" name="title" required maxLength={200} placeholder={t("assemblyTitlePlaceholder")} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="type">{t("type")}</Label>
        <FormSelect
          id="type"
          name="type"
          options={[
            { value: "redovna", label: tt("redovna") },
            { value: "izborna", label: tt("izborna") },
            { value: "izvanredna", label: tt("izvanredna") },
          ]}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="scheduledAt">{t("scheduledAt")}</Label>
        <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="hostId">{t("host")}</Label>
        <FormSelect id="hostId" name="hostId" options={users} defaultValue={me} />
      </div>
      <div>
        <Button type="submit">{t("create")}</Button>
      </div>
    </ActionForm>
  );
}
