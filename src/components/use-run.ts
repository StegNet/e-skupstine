"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { Result } from "@/lib/errors";

/** Runs a wrapped server action: toasts its error (translated) or success, then refreshes server data. */
export function useRun() {
  const t = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run<T>(fn: () => Promise<Result<T>>, success?: string, onOk?: (data: T) => void) {
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          toast.error(t.has(r.error) ? t(r.error) : t("generic"));
          return;
        }
        if (success) toast.success(success);
        onOk?.(r.data);
        router.refresh();
      } catch (e) {
        console.error(e);
        toast.error(t("generic"));
      }
    });
  }
  return { run, pending };
}
