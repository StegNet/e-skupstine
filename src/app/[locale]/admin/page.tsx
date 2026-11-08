import { and, asc, desc, eq } from "drizzle-orm";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { setUserRole } from "@/actions/admin";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, redirect } from "@/i18n/navigation";
import { canVote, getUser, isAdmin } from "@/lib/assembly";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { statut } from "@/lib/statut";
import { CreateAssembly } from "./create-assembly";
import { MemberImport } from "./member-import";

export default async function AdminPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await getUser();
  if (!me || !isAdmin(me)) redirect({ href: "/", locale: await getLocale() });
  const t = await getTranslations("admin");
  const [members, users, assemblies] = await Promise.all([
    db.select().from(s.member).orderBy(asc(s.member.fullName)),
    db
      .select({ id: s.user.id, name: s.user.name, email: s.user.email, oib: s.account.accountId, role: s.user.role })
      .from(s.user)
      .leftJoin(s.account, and(eq(s.account.userId, s.user.id), eq(s.account.providerId, "certilia")))
      .orderBy(asc(s.user.name)),
    db.select().from(s.assembly).orderBy(desc(s.assembly.createdAt)),
  ]);
  const voters = members.filter(canVote).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("assemblies")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CreateAssembly users={users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))} me={me!.id} />
          <ul className="divide-y rounded-lg border">
            {assemblies.map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3">
                <Link href={`/a/${a.id}/manage`} className="flex-1 font-medium hover:underline">
                  {a.title}
                </Link>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("members")} <span className="text-sm font-normal text-muted-foreground">{t("memberCount", { total: members.length, voters })}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MemberImport
            categoriesHelp={
              Object.keys(statut.memberCategories).length
                ? t("categoriesHelp", {
                    list: Object.entries(statut.memberCategories)
                      .map(([c, v]) => `${c} (${t("votingRight").toLowerCase()}: ${v ? t("yes").toLowerCase() : t("no").toLowerCase()})`)
                      .join(", "),
                  })
                : null
            }
          />
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>OIB</TableHead>
                  <TableHead>{t("email")}</TableHead>
                  <TableHead>{t("category")}</TableHead>
                  <TableHead>{t("votingRight")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.fullName}</TableCell>
                    <TableCell className="font-mono text-xs">{m.oib}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>{m.category}</TableCell>
                    <TableCell>{canVote(m) ? t("yes") : m.leftAt ? t("leftOn", { date: m.leftAt }) : t("no")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("users")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">{t("usersHelp")}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>OIB</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email.endsWith(".invalid") ? "—" : u.email}</TableCell>
                  <TableCell className="font-mono text-xs">{u.oib ?? "—"}</TableCell>
                  <TableCell>{u.role === "admin" ? <Badge>{t("admin")}</Badge> : t("user")}</TableCell>
                  <TableCell className="text-right">
                    {u.id !== me!.id && (
                      <ActionButton
                        size="sm"
                        variant="outline"
                        action={setUserRole.bind(null, u.id, u.role === "admin" ? "user" : "admin")}
                        label={u.role === "admin" ? t("removeAdmin") : t("makeAdmin")}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
