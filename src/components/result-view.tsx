import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { AgendaQuestion } from "@/lib/assembly";

/** Option labels: motions use the translated Za/Protiv/Suzdržan, elections their own option text. */
export async function optionLabels(q: Pick<AgendaQuestion, "kind" | "options">) {
  const t = await getTranslations("motion");
  return q.kind === "motion" ? [t("for"), t("against"), t("abstain")] : q.options;
}

export async function ResultView({ q }: { q: AgendaQuestion }) {
  const t = await getTranslations("result");
  const r = q.result;
  if (!r) return null;
  const labels = await optionLabels(q);
  const max = Math.max(1, ...r.counts);
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {labels.map((label, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-2 text-sm">
            <span className="truncate">{label}</span>
            <span className="h-2 rounded bg-primary/80" style={{ width: `${(r.counts[i] / max) * 100}%` }} aria-hidden />
            <span className="text-right tabular-nums">{r.counts[i]}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("ballots", { valid: r.valid, invalid: r.invalid })}</p>
      {r.roll && (
        // Public vote: who chose what.
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {labels.map((label, i) => {
            const names = r.roll!.filter((v) => v.choices?.includes(i)).map((v) => v.name);
            return names.length ? (
              <li key={i}>
                {label}: {names.join(", ")}
              </li>
            ) : null;
          })}
          {r.roll.some((v) => !v.choices) && (
            <li>
              {t("invalid")}: {r.roll.filter((v) => !v.choices).map((v) => v.name).join(", ")}
            </li>
          )}
        </ul>
      )}
      {r.adopted !== null && <Badge variant={r.adopted ? "default" : "destructive"}>{r.adopted ? t("adopted") : t("rejected")}</Badge>}
    </div>
  );
}
