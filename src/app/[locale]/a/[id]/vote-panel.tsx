"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { castVote } from "@/actions/participant";
import { useRun } from "@/components/use-run";
import { Button } from "@/components/ui/button";
import { encryptBallot, sha256Hex } from "@/lib/ballot-crypto";
import type { Result } from "@/lib/errors";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "vote"]);

const KEY = "eskupstina:receipts";
const CHANGED = "eskupstina:receipts-changed";
export type StoredReceipt = { receipt: string; assemblyId: string; question: string };

function readRaw() {
  try {
    return localStorage.getItem(KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
function parse(raw: string): Record<string, StoredReceipt> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGED, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGED, cb);
  };
}
/** Receipts live only in this browser (the server must never learn which receipt is whose). */
function useReceipts() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "{}");
  return useMemo(() => parse(raw), [raw]);
}
function saveReceipt(questionId: string, r: StoredReceipt) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...parse(readRaw()), [questionId]: r }));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // Storage unavailable: the receipt is still shown on screen.
  }
}

export function VotePanel({
  assemblyId,
  question,
  labels,
  committeeKeys,
  threshold,
}: {
  assemblyId: string;
  question: { id: string; text: string; maxChoices: number; secret: boolean };
  labels: string[];
  committeeKeys: JsonWebKey[];
  threshold: number;
}) {
  const t = useTranslations("vote");
  const { run, pending } = useRun();
  const [choices, setChoices] = useState<number[]>([]);
  const single = question.maxChoices === 1;

  function toggle(i: number) {
    if (single) return setChoices([i]);
    setChoices((c) => (c.includes(i) ? c.filter((x) => x !== i) : c.length < question.maxChoices ? [...c, i] : c));
  }

  function submit() {
    if (!choices.length || !window.confirm(question.secret ? t("confirm") : t("confirmPublic"))) return;
    run(async (): Promise<Result<string>> => {
      // Logs and spans here never carry the choice or the receipt.
      const bundle = await Sentry.startSpan({ name: "encrypt ballot", op: "crypto.encrypt" }, () =>
        encryptBallot(question.id, [...choices].sort((a, b) => a - b), committeeKeys, threshold),
      );
      const r = await castVote(question.id, bundle);
      logger.info(r.ok ? "ballot sent" : "ballot refused", { questionId: question.id, error: r.ok ? undefined : r.error });
      if (r.ok) {
        if ((await sha256Hex(bundle)) !== r.data) {
          logger.error("receipt from server does not match the ballot sent", { questionId: question.id });
          toast.warning(t("receiptMismatch"));
        }
        saveReceipt(question.id, { receipt: r.data, assemblyId, question: question.text });
      }
      return r;
    }, t("recorded"));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{single ? t("pickOne") : t("pickUpTo", { n: question.maxChoices })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {labels.map((label, i) => (
          <Button
            key={i}
            type="button"
            size="lg"
            variant={choices.includes(i) ? "default" : "outline"}
            aria-pressed={choices.includes(i)}
            onClick={() => toggle(i)}
            className="h-auto justify-start py-3 text-left whitespace-normal"
          >
            {label}
          </Button>
        ))}
      </div>
      <Button size="lg" onClick={submit} disabled={pending || !choices.length}>
        {pending ? t("encrypting") : t("submit")}
      </Button>
      <p className="text-xs text-muted-foreground">{question.secret ? t("secrecy") : t("publicBallot")}</p>
    </div>
  );
}

export function ReceiptNote({ questionId }: { questionId: string }) {
  const t = useTranslations("vote");
  const receipt = useReceipts()[questionId]?.receipt;
  return (
    <div className="space-y-1">
      <p className="font-medium">{t("alreadyVoted")}</p>
      {receipt ? (
        <p className="text-xs">
          {t("yourReceipt")} <code className="break-all">{receipt}</code>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("receiptOtherDevice")}</p>
      )}
    </div>
  );
}

export function MyReceipts({ assemblyId }: { assemblyId: string }) {
  const t = useTranslations("vote");
  const items = Object.entries(useReceipts()).filter(([, r]) => r.assemblyId === assemblyId);
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{t("myReceipts")}</h2>
      <p className="text-xs text-muted-foreground">{t("receiptsHelp")}</p>
      <ul className="space-y-1 text-xs">
        {items.map(([qid, r]) => (
          <li key={qid}>
            {r.question}: <code className="break-all">{r.receipt}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
