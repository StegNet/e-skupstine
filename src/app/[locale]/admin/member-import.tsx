"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { importMembers } from "@/actions/admin";
import { useRun } from "@/components/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function MemberImport({ categoriesHelp }: { categoriesHelp: string | null }) {
  const t = useTranslations("admin");
  const te = useTranslations("importErrors");
  const { run, pending } = useRun();
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<{ imported: number; errors: { line: number; message: string }[] } | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("importHelp")}</p>
      {categoriesHelp && <p className="text-sm text-muted-foreground">{categoriesHelp}</p>}
      <Input
        type="file"
        accept=".csv,text/csv"
        aria-label={t("csvFile")}
        onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? "")}
      />
      <Textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={5}
        className="font-mono text-xs"
        placeholder={"oib;ime_prezime;email;datum_rodenja;datum_pristupanja;kategorija;pravo_glasa\n12345678903;Ana Horvat;ana@example.hr;1.2.1980.;1.1.2020.;redovni;da"}
        aria-label={t("csv")}
      />
      <Button disabled={pending || !csv.trim()} onClick={() => run(() => importMembers(csv), undefined, setReport)}>
        {t("import")}
      </Button>
      {report && (
        <div className="text-sm">
          <p>{t("imported", { count: report.imported })}</p>
          {report.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-destructive">
              {report.errors.map((e) => (
                <li key={e.line}>{t("lineError", { line: e.line, error: te.has(e.message) ? te(e.message) : e.message })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
