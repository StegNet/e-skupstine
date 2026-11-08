"use client";

import type { ReactNode } from "react";
import type { Result } from "@/lib/errors";
import { useRun } from "./use-run";

/** A form posting FormData to a wrapped server action, with error toasts and a refresh on success. */
export function ActionForm<T>({
  action,
  children,
  className,
  success,
  reset = true,
  onDone,
}: {
  action: (form: FormData) => Promise<Result<T>>;
  children: ReactNode;
  className?: string;
  success?: string;
  reset?: boolean;
  onDone?: (data: T) => void;
}) {
  const { run, pending } = useRun();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(
          () => action(new FormData(form)),
          success,
          (data) => {
            if (reset) form.reset();
            onDone?.(data);
          },
        );
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
