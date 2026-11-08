"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import type { Result } from "@/lib/errors";
import { useRun } from "./use-run";

export function ActionButton({
  action,
  label,
  confirm,
  success,
  ...props
}: {
  action: () => Promise<Result<unknown>>;
  label: string;
  confirm?: string;
  success?: string;
} & Omit<ComponentProps<typeof Button>, "action" | "onClick">) {
  const { run, pending } = useRun();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        run(action, success);
      }}
    >
      {label}
    </Button>
  );
}
