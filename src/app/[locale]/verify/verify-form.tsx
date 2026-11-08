"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { lookupReceipt, lookupSeal } from "@/actions/participant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sha256Hex, verifyBytes } from "@/lib/ballot-crypto";

type SealInfo = {
  title: string;
  sealMethod: string;
  sealedAt: Date | null;
  isOriginal: boolean;
  signatures: { name: string; ok: boolean | null }[];
};

export function VerifyForm({ receipt: initialReceipt }: { receipt?: string }) {
  const t = useTranslations("verify");
  const format = useFormatter();
  const [seal, setSeal] = useState<SealInfo | null | "none">(null);
  const [receipt, setReceipt] = useState(initialReceipt ?? "");
  const [found, setFound] = useState<{ assembly: string; question: string; status: string } | null | "none">(null);
  const [busy, setBusy] = useState(false);

  async function checkPdf(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await lookupSeal(await sha256Hex(bytes));
    setBusy(false);
    if (!r.ok || !r.data) return setSeal("none");
    const own = r.data.sealMethod === "own_keys";
    const signatures = await Promise.all(
      r.data.signatures.map(async (x) => ({
        name: x.name,
        // own_keys: check each committee signature here in the browser against the registered public key.
        ok: own && x.publicKeyJwk && x.signature ? await verifyBytes(x.publicKeyJwk, bytes, x.signature) : null,
      })),
    );
    setSeal({ ...r.data, signatures });
  }

  async function checkReceipt(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await lookupReceipt(receipt);
    setBusy(false);
    setFound(r.ok && r.data ? r.data : "none");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("pdfTitle")}</CardTitle>
          <CardDescription>{t("pdfHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input type="file" accept="application/pdf" aria-label={t("pdfTitle")} onChange={(e) => checkPdf(e.target.files?.[0])} disabled={busy} />
          {seal === "none" && <p className="text-sm text-destructive">{t("pdfUnknown")}</p>}
          {seal && seal !== "none" && (
            <div className="space-y-2 text-sm">
              <p>
                {t("pdfFound", { title: seal.title })}{" "}
                {seal.sealedAt ? t("sealedOn", { date: format.dateTime(new Date(seal.sealedAt), { dateStyle: "medium" }) }) : t("notSealedYet")}
              </p>
              {seal.sealMethod === "own_keys" ? (
                <ul className="space-y-1">
                  {seal.signatures.map((x) => (
                    <li key={x.name}>
                      {x.ok ? "✓" : "✗"} {x.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p>{t("signedBy", { names: seal.signatures.map((x) => x.name).join(", ") })}</p>
                  <p className="text-muted-foreground">{seal.isOriginal ? t("originalNotSigned") : t("qesHelp")}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("receiptTitle")}</CardTitle>
          <CardDescription>{t("receiptHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={checkReceipt} className="space-y-3">
            <Label htmlFor="receipt" className="sr-only">
              {t("receiptTitle")}
            </Label>
            <Input id="receipt" value={receipt} onChange={(e) => setReceipt(e.target.value)} className="font-mono text-xs" required />
            <Button type="submit" disabled={busy}>{t("check")}</Button>
          </form>
          {found === "none" && <p className="mt-3 text-sm text-destructive">{t("receiptUnknown")}</p>}
          {found && found !== "none" && (
            <p className="mt-3 text-sm">
              {found.status === "published"
                ? t("receiptCounted", { assembly: found.assembly, question: found.question })
                : t("receiptStored", { assembly: found.assembly, question: found.question })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
