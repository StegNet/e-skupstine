"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  confirmResult,
  getQuestionData,
  registerKeys,
  submitCertiliaPdf,
  submitOwnSignature,
  submitShares,
} from "@/actions/committee";
import { generateZapisnik } from "@/actions/manage";
import { ActionButton } from "@/components/action-button";
import { useRun } from "@/components/use-run";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateCommitteeKeys,
  signBytes,
  tallyBallots,
  unwrapMyShares,
  type KeyFile,
  type Tally,
} from "@/lib/ballot-crypto";
import type { Result } from "@/lib/errors";
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["e-skupstina", "committee"]);

type Q = {
  id: string;
  text: string;
  status: string;
  labels: string[];
  submissions: number;
  confirmations: number;
  mySubmitted: boolean;
  myConfirmed: boolean;
};

export function CommitteePanel(p: {
  assemblyId: string;
  userId: string;
  status: string;
  sealMethod: "certilia_app" | "own_keys";
  threshold: number;
  myIndex: number;
  keysRegistered: boolean;
  questions: Q[];
  seal: { sealed: boolean; signatures: number; signedByMe: boolean } | null;
  allPublished: boolean;
}) {
  const t = useTranslations("committee");
  const { run, pending } = useRun();
  const [key, setKey] = useState<KeyFile | null>(null);
  const [recounts, setRecounts] = useState<Record<string, Tally>>({});
  const ownKeys = p.sealMethod === "own_keys";

  function download(file: KeyFile) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `e-skupstina-kljuc-${p.assemblyId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function generate() {
    if (p.keysRegistered && !window.confirm(t("regenerateConfirm"))) return;
    run(async () => {
      const k = await Sentry.startSpan({ name: "generate committee keys", op: "crypto.keygen" }, () =>
        generateCommitteeKeys(p.assemblyId, p.userId, ownKeys),
      );
      download(k.file);
      logger.info("committee key generated and downloaded", { assemblyId: p.assemblyId, signingKey: ownKeys });
      const r = await registerKeys(p.assemblyId, k.encPublic, k.signPublic);
      if (r.ok) setKey(k.file);
      return r;
    }, t("keysRegistered"));
  }

  async function loadKey(file: File | undefined) {
    if (!file) return;
    try {
      const k = JSON.parse(await file.text()) as KeyFile;
      if (k.v !== 1 || k.assemblyId !== p.assemblyId || k.userId !== p.userId || !k.enc) throw new Error();
      if (ownKeys && !k.sign) throw new Error();
      setKey(k);
      logger.info("committee key file loaded", { assemblyId: p.assemblyId });
      toast.success(t("keyLoaded"));
    } catch {
      logger.warn("committee key file rejected (wrong file, session or person)", { assemblyId: p.assemblyId });
      toast.error(t("wrongKeyFile"));
    }
  }

  const needKey = () => {
    if (!key) toast.error(t("loadKeyFirst"));
    return key;
  };

  function decrypt(q: Q) {
    const k = needKey();
    if (!k) return;
    run(async (): Promise<Result<void>> => {
      const d = await getQuestionData(q.id);
      if (!d.ok) return d;
      const shares = await Sentry.startSpan({ name: "unwrap key shares", op: "crypto.decrypt" }, () =>
        unwrapMyShares(q.id, d.data.ballots, p.myIndex, k.enc),
      );
      logger.info("key shares unwrapped", { questionId: q.id, ballots: d.data.ballots.length, unwrapped: Object.keys(shares).length });
      return submitShares(q.id, shares);
    }, t("sharesSubmitted"));
  }

  function recount(q: Q) {
    run(async (): Promise<Result<void>> => {
      const d = await getQuestionData(q.id);
      if (!d.ok) return d;
      const { counts, valid, invalid } = await Sentry.startSpan({ name: "recount in browser", op: "ballot.tally" }, () =>
        tallyBallots(d.data.question, d.data.ballots, d.data.submissions),
      );
      const tally = { counts, valid, invalid };
      logger.info("browser recount done", { questionId: q.id, ballots: d.data.ballots.length });
      setRecounts((r) => ({ ...r, [q.id]: tally }));
      return confirmResult(q.id, tally);
    }, t("confirmed"));
  }

  function signOwn() {
    const k = needKey();
    if (!k?.sign) return;
    run(async (): Promise<Result<void>> => {
      const res = await fetch(`/api/assemblies/${p.assemblyId}/zapisnik?original=1`);
      if (!res.ok) return { ok: false, error: "generic" };
      const sig = await signBytes(k.sign!, new Uint8Array(await res.arrayBuffer()));
      logger.info("zapisnik signed with own key", { assemblyId: p.assemblyId });
      return submitOwnSignature(p.assemblyId, sig);
    }, t("signed"));
  }

  function uploadSigned(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    run(() => submitCertiliaPdf(p.assemblyId, form), t("signed"));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("keyTitle")}</CardTitle>
          <CardDescription>{t("keyHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{p.keysRegistered ? t("keyIsRegistered") : t("keyNotRegistered")}</p>
          {p.status === "draft" && (
            <Button variant={p.keysRegistered ? "outline" : "default"} onClick={generate} disabled={pending}>
              {p.keysRegistered ? t("regenerate") : t("generate")}
            </Button>
          )}
          {p.status !== "draft" && (
            <div className="space-y-1">
              <Label htmlFor="keyfile">{key ? t("keyLoaded") : t("loadKey")}</Label>
              <Input id="keyfile" type="file" accept=".json,application/json" onChange={(e) => loadKey(e.target.files?.[0])} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("countTitle")}</CardTitle>
          <CardDescription>{t("countHelp", { k: p.threshold })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {p.questions.length === 0 && <p className="text-sm text-muted-foreground">{t("nothingToCount")}</p>}
          {p.questions.map((q) => (
            <div key={q.id} className="space-y-2 border-b pb-4 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm font-medium">{q.text}</span>
                <Badge variant="outline">{t("sharesCount", { n: q.submissions, k: p.threshold })}</Badge>
                <Badge variant="outline">{t("confirmCount", { n: q.confirmations, k: p.threshold })}</Badge>
              </div>
              {q.status === "closed" && !q.mySubmitted && (
                <Button size="sm" onClick={() => decrypt(q)} disabled={pending}>
                  {t("decrypt")}
                </Button>
              )}
              {q.status === "closed" && q.mySubmitted && <p className="text-xs text-muted-foreground">{t("waitingForOthers")}</p>}
              {(q.status === "counted" || q.status === "published") && !q.myConfirmed && (
                <Button size="sm" onClick={() => recount(q)} disabled={pending}>
                  {t("recount")}
                </Button>
              )}
              {q.myConfirmed && <p className="text-xs">{t("youConfirmed")}</p>}
              {recounts[q.id] && (
                <ul className="text-sm">
                  {q.labels.map((l, i) => (
                    <li key={i}>
                      {l}: <span className="tabular-nums">{recounts[q.id].counts[i]}</span>
                    </li>
                  ))}
                  <li className="text-xs text-muted-foreground">
                    {t("validInvalid", { valid: recounts[q.id].valid, invalid: recounts[q.id].invalid })}
                  </li>
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {(p.status === "closed" || p.status === "sealed") && (
        <Card>
          <CardHeader>
            <CardTitle>{t("sealTitle")}</CardTitle>
            <CardDescription>{ownKeys ? t("sealHelpOwn") : t("sealHelpCertilia")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!p.seal && (
              <>
                <p className="text-sm">{p.allPublished ? t("readyForZapisnik") : t("notAllPublished")}</p>
                <ActionButton action={generateZapisnik.bind(null, p.assemblyId)} label={t("generateZapisnik")} disabled={!p.allPublished} />
              </>
            )}
            {p.seal && (
              <>
                <p className="text-sm">
                  {p.seal.sealed ? t("sealed") : t("signatures", { n: p.seal.signatures, k: p.threshold })}
                </p>
                <a href={`/api/assemblies/${p.assemblyId}/zapisnik`} className="text-sm underline">
                  {ownKeys ? t("download") : t("downloadLatest")}
                </a>
                {!p.seal.sealed && !p.seal.signedByMe && ownKeys && (
                  <div>
                    <Button onClick={signOwn} disabled={pending}>
                      {t("sign")}
                    </Button>
                  </div>
                )}
                {!p.seal.sealed && !p.seal.signedByMe && !ownKeys && (
                  <form onSubmit={uploadSigned} className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="pdf">{t("uploadSigned")}</Label>
                      <Input id="pdf" name="pdf" type="file" accept="application/pdf" required />
                    </div>
                    <Button type="submit" disabled={pending}>{t("upload")}</Button>
                  </form>
                )}
                {p.seal.signedByMe && !p.seal.sealed && <p className="text-xs">{t("youSigned")}</p>}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
