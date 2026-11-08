import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  published: "default",
  sealed: "secondary",
};

export async function StatusBadge({ status, kind = "assembly" }: { status: string; kind?: "assembly" | "question" }) {
  const t = await getTranslations("status");
  return <Badge variant={VARIANT[status] ?? "outline"}>{t(`${kind}.${status}` as "assembly.open")}</Badge>;
}
