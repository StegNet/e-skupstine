"use client";

import { useTranslations } from "next-intl";
import { addAgendaItem, addCommitteeMember, addQuestion, updateSettings } from "@/actions/manage";
import { ActionForm } from "@/components/action-form";
import { FormSelect } from "@/components/form-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Settings = {
  title: string;
  type: string;
  scheduledAt: string;
  videoUrl: string;
  quorumPercent: number;
  threshold: number;
  sealMethod: string;
  statutConfirmed: boolean;
};

export function SettingsForm({ assemblyId, s }: { assemblyId: string; s: Settings }) {
  const t = useTranslations("manage");
  const tt = useTranslations("assemblyType");
  const ts = useTranslations("sealMethod");
  return (
    <ActionForm action={updateSettings.bind(null, assemblyId)} reset={false} success={t("saved")} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="title">{t("title")}</Label>
        <Input id="title" name="title" defaultValue={s.title} required maxLength={200} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="type">{t("type")}</Label>
        <FormSelect
          id="type"
          name="type"
          defaultValue={s.type}
          options={[
            { value: "redovna", label: tt("redovna") },
            { value: "izborna", label: tt("izborna") },
            { value: "izvanredna", label: tt("izvanredna") },
          ]}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="scheduledAt">{t("scheduledAt")}</Label>
        <Input id="scheduledAt" name="scheduledAt" type="datetime-local" defaultValue={s.scheduledAt} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="videoUrl">{t("videoUrl")}</Label>
        <Input id="videoUrl" name="videoUrl" type="url" maxLength={500} defaultValue={s.videoUrl} placeholder="https://meet.jit.si/…" />
        <p className="text-xs text-muted-foreground">{t("videoUrlHelp")}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="quorumPercent">{t("quorum")}</Label>
        <Input id="quorumPercent" name="quorumPercent" type="number" min={0} max={99} defaultValue={s.quorumPercent} required />
        <p className="text-xs text-muted-foreground">{t("quorumHelp")}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="threshold">{t("threshold")}</Label>
        <Input id="threshold" name="threshold" type="number" min={2} max={20} defaultValue={s.threshold} required />
        <p className="text-xs text-muted-foreground">{t("thresholdHelp")}</p>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="sealMethod">{t("sealMethod")}</Label>
        <FormSelect
          id="sealMethod"
          name="sealMethod"
          defaultValue={s.sealMethod}
          options={[
            { value: "certilia_app", label: ts("certilia_app") },
            { value: "own_keys", label: ts("own_keys") },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t("sealMethodHelp")}</p>
      </div>
      <Label className="flex items-start gap-2 font-normal sm:col-span-2">
        <Checkbox name="statutConfirmed" defaultChecked={s.statutConfirmed} className="mt-0.5" />
        <span>{t("statutConfirm")}</span>
      </Label>
      <div>
        <Button type="submit">{t("save")}</Button>
      </div>
    </ActionForm>
  );
}

export function AddCommitteeMember({
  assemblyId,
  users,
  roles,
}: {
  assemblyId: string;
  users: { value: string; label: string }[];
  /** Statut signer roles still to be given to someone. */
  roles: string[];
}) {
  const t = useTranslations("manage");
  const tr = useTranslations("signerRole");
  if (!users.length) return null;
  return (
    <ActionForm action={addCommitteeMember.bind(null, assemblyId)} className="flex flex-wrap items-end gap-2">
      <div className="min-w-64 flex-1 space-y-1">
        <Label htmlFor="userId">{t("addCommittee")}</Label>
        {/* Remount when the list changes so a just-added person is not still selected. */}
        <FormSelect key={users.map((u) => u.value).join()} id="userId" name="userId" options={users} />
      </div>
      {roles.length > 0 && (
        <div className="min-w-48 space-y-1">
          <Label htmlFor="role">{t("signerRole")}</Label>
          <FormSelect
            key={roles.join()}
            id="role"
            name="role"
            options={[...new Set(roles)].map((r) => ({ value: r, label: tr(r) })).concat({ value: "none", label: t("noRole") })}
          />
        </div>
      )}
      <Button type="submit">{t("add")}</Button>
    </ActionForm>
  );
}

export function AddAgendaItem({ assemblyId }: { assemblyId: string }) {
  const t = useTranslations("manage");
  return (
    <ActionForm action={addAgendaItem.bind(null, assemblyId)} className="space-y-2">
      <Label htmlFor="item-title">{t("newItem")}</Label>
      <Input id="item-title" name="title" required maxLength={300} placeholder={t("itemPlaceholder")} />
      <Textarea name="description" rows={2} maxLength={5000} placeholder={t("itemDescription")} aria-label={t("itemDescription")} />
      <Button type="submit" size="sm">{t("addItem")}</Button>
    </ActionForm>
  );
}

export type QuestionDefaults = { base: string; fraction: string; secret: boolean };

export function AddQuestion({ assemblyId, itemId, defaults }: { assemblyId: string; itemId: string; defaults: QuestionDefaults }) {
  const t = useTranslations("manage");
  const id = (k: string) => `${itemId}-${k}`;
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("addQuestion")}</summary>
      <ActionForm action={addQuestion.bind(null, assemblyId, itemId)} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("text")}>{t("questionText")}</Label>
          <Input id={id("text")} name="text" required maxLength={1000} placeholder={t("questionPlaceholder")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("kind")}>{t("kind")}</Label>
          <FormSelect
            id={id("kind")}
            name="kind"
            options={[
              { value: "motion", label: t("kindMotion") },
              { value: "election", label: t("kindElection") },
            ]}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("ballot")}>{t("ballot")}</Label>
          <FormSelect
            id={id("ballot")}
            name="ballot"
            defaultValue={defaults.secret ? "secret" : "public"}
            options={[
              { value: "public", label: t("ballotPublic") },
              { value: "secret", label: t("ballotSecret") },
            ]}
          />
          <p className="text-xs text-muted-foreground">{defaults.secret ? t("ballotHelpSecret") : t("ballotHelpPublic")}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("vis")}>{t("visibility")}</Label>
          <FormSelect
            id={id("vis")}
            name="resultsVisibility"
            options={[
              { value: "public", label: t("visPublic") },
              { value: "restricted", label: t("visRestricted") },
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("base")}>{t("majorityBase")}</Label>
          <FormSelect
            id={id("base")}
            name="majorityBase"
            defaultValue={defaults.base}
            options={[
              { value: "votes_cast", label: t("baseVotesCast") },
              { value: "present", label: t("basePresent") },
              { value: "members", label: t("baseMembers") },
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("frac")}>{t("majorityFraction")}</Label>
          <FormSelect
            id={id("frac")}
            name="majorityFraction"
            defaultValue={defaults.fraction}
            options={[
              { value: "half", label: t("fracHalf") },
              { value: "two_thirds", label: t("fracTwoThirds") },
            ]}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("options")}>{t("options")}</Label>
          <Textarea id={id("options")} name="options" rows={3} placeholder={t("optionsPlaceholder")} />
          <p className="text-xs text-muted-foreground">{t("optionsHelp")}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("max")}>{t("maxChoices")}</Label>
          <Input id={id("max")} name="maxChoices" type="number" min={1} max={50} defaultValue={1} />
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm">{t("addQuestionButton")}</Button>
        </div>
      </ActionForm>
    </details>
  );
}
