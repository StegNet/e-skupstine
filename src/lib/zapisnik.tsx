// The zapisnik (minutes) PDF. It is the legal record filed with the registry and the document the committee seals,
// so it always contains every count, restricted questions included. Croatian only.
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import * as s from "./db/schema";
import { getLogger } from "@logtape/logtape";
import { statut } from "./statut";

const logger = getLogger(["e-skupstina", "zapisnik"]);

const fontDir = path.join(process.cwd(), "assets/fonts");
Font.register({
  family: "Noto Sans",
  fonts: [
    { src: path.join(fontDir, "NotoSans-Regular.ttf") },
    { src: path.join(fontDir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const st = StyleSheet.create({
  page: { fontFamily: "Noto Sans", fontSize: 10, padding: 48, lineHeight: 1.4 },
  org: { textAlign: "center", fontWeight: "bold", marginBottom: 12 },
  h1: { fontSize: 16, fontWeight: "bold", textAlign: "center", lineHeight: 1.2, marginBottom: 4 },
  sub: { textAlign: "center", marginBottom: 16 },
  h2: { fontSize: 12, fontWeight: "bold", marginTop: 14, marginBottom: 4 },
  h3: { fontWeight: "bold", marginTop: 8 },
  row: { flexDirection: "row", borderBottom: "0.5pt solid #999", paddingVertical: 2 },
  cellWide: { flex: 1 },
  cell: { width: 80, textAlign: "right" },
  receipt: { fontSize: 7 },
  signature: { marginTop: 24, flexDirection: "row", flexWrap: "wrap", gap: 24 },
  line: { width: 200, borderTop: "0.5pt solid #000", paddingTop: 2, marginTop: 28 },
  roll: { fontSize: 9 },
});

const BASE = { votes_cast: "danih važećih glasova", present: "prisutnih članova", members: "svih članova s pravom glasa" };
const FRACTION = { half: "više od polovine", two_thirds: "najmanje dvije trećine" };
const MOTION_OPTIONS = ["Za", "Protiv", "Suzdržan"];
const TYPE_GENITIVE = { redovna: "redovne", izborna: "izborne", izvanredna: "izvanredne" } as const;
const ROLE = { chair: "Predsjedavajući", recorder: "Zapisničar", verifier: "Ovjerovitelj zapisnika" } as const;
/** "2 člana", "5 članova" */
const clanova = (n: number) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "člana" : "članova");

async function load(assemblyId: string) {
  const a = await db.query.assembly.findFirst({ where: eq(s.assembly.id, assemblyId) });
  if (!a) throw new Error("assembly not found");
  const host = await db.query.user.findFirst({ where: eq(s.user.id, a.hostId), columns: { name: true } });
  const attendees = await db
    .select({ name: s.user.name, memberName: s.member.fullName, isGuest: s.attendance.isGuest })
    .from(s.attendance)
    .innerJoin(s.user, eq(s.user.id, s.attendance.userId))
    .leftJoin(s.member, eq(s.member.id, s.attendance.memberId))
    .where(and(eq(s.attendance.assemblyId, assemblyId), isNull(s.attendance.removedAt)))
    .orderBy(asc(s.user.name));
  const committee = await db
    .select({ name: s.user.name, role: s.committeeMember.role })
    .from(s.committeeMember)
    .innerJoin(s.user, eq(s.user.id, s.committeeMember.userId))
    .where(eq(s.committeeMember.assemblyId, assemblyId))
    .orderBy(asc(s.committeeMember.position));
  const items = await db.query.agendaItem.findMany({
    where: eq(s.agendaItem.assemblyId, assemblyId),
    orderBy: asc(s.agendaItem.position),
  });
  const agenda = await Promise.all(
    items.map(async (item) => {
      const rows = await db
        .select({ q: s.question, r: s.result })
        .from(s.question)
        .innerJoin(s.result, eq(s.result.questionId, s.question.id))
        .where(eq(s.question.agendaItemId, item.id))
        .orderBy(asc(s.question.position));
      const questions = await Promise.all(
        rows.map(async ({ q, r }) => {
          const receipts = await db
            .select({ receipt: s.ballot.receipt })
            .from(s.ballot)
            .where(eq(s.ballot.questionId, q.id))
            .orderBy(asc(s.ballot.receipt));
          return { q, r, receipts: receipts.map((x) => x.receipt) };
        }),
      );
      return { item, questions };
    }),
  );
  return { a, hostName: host?.name ?? "", attendees, committee, agenda };
}

type Data = Awaited<ReturnType<typeof load>>;

function Zapisnik({ a, hostName, attendees, committee, agenda }: Data) {
  const date = (d: Date | null) => (d ? d.toLocaleString("hr-HR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Zagreb" }) : "");
  const members = attendees.filter((x) => x.memberName);
  const others = attendees.filter((x) => !x.memberName);
  const numbered = agenda.flatMap((g) => g.questions.map((q) => ({ ...q, itemTitle: g.item.title })));
  // Statut signers (chair, recorder…) first, then the rest of the committee.
  const signers = [...committee].sort((x, y) => Number(!x.role) - Number(!y.role));
  const roleList = signers.flatMap((c) => (c.role ? [ROLE[c.role].toLowerCase()] : []));
  return (
    <Document title={`Zapisnik – ${a.title}`} author={statut.name} creator="e-Skupština">
      <Page size="A4" style={st.page}>
        <Text style={st.org}>{statut.name}</Text>
        <Text style={st.h1}>ZAPISNIK</Text>
        <Text style={st.sub}>s {TYPE_GENITIVE[a.type]} sjednice Skupštine</Text>
        <Text>Naziv sjednice: {a.title}</Text>
        <Text>
          Sjednica je održana elektroničkim putem{a.scheduledAt ? `, ${date(a.scheduledAt)}` : ""},{" "}
          {a.videoUrl ? "uz istovremenu razmjenu slike i zvuka (videoveza); glasovalo se u sustavu e-Skupština" : "u sustavu e-Skupština"}, u
          skladu sa statutom udruge.
        </Text>
        {a.invitedAt && <Text>Poziv s prijedlogom dnevnog reda upućen je članovima elektroničkom poštom {date(a.invitedAt)}.</Text>}
        <Text>Voditelj sjednice: {hostName}</Text>
        {signers
          .filter((c) => c.role)
          .map((c) => (
            <Text key={c.name}>
              {ROLE[c.role!]}: {c.name}
            </Text>
          ))}

        <Text style={st.h2}>Prisutni</Text>
        <Text>
          Prisutni članovi s pravom glasa ({members.length}): {members.map((m) => m.memberName).join(", ") || "–"}
        </Text>
        {others.length > 0 && (
          <Text>
            Ostali prisutni bez prava glasa ({others.length}):{" "}
            {others.map((m) => `${m.name}${m.isGuest ? " (gost)" : ""}`).join(", ")}
          </Text>
        )}
        <Text>Kvorum: više od {a.quorumPercent}% članova s pravom glasa.</Text>

        <Text style={st.h2}>Dnevni red</Text>
        {agenda.map((g, i) => (
          <Text key={g.item.id}>
            {i + 1}. {g.item.title}
          </Text>
        ))}

        {agenda.map((g, i) => (
          <View key={g.item.id}>
            <Text style={st.h2}>
              Ad {i + 1}. {g.item.title}
            </Text>
            {g.item.description ? <Text>{g.item.description}</Text> : null}
            {g.questions.map(({ q, r }) => {
              const options = q.kind === "motion" ? MOTION_OPTIONS : q.options;
              return (
                <View key={q.id} wrap={false}>
                  <Text style={st.h3}>{q.text}</Text>
                  <Text>
                    {q.secret
                      ? `Tajno glasovanje${statut.secretBallotByDefault ? "" : " (prema odluci Skupštine)"} šifriranim elektroničkim listićima.`
                      : "Javno glasovanje (poimenično)."}{" "}
                    Prisutno članova s pravom glasa pri otvaranju glasovanja: {q.presentAtOpen} od {q.eligibleAtOpen}.
                    {q.kind === "election" ? ` Najviše ${q.maxChoices} izbor(a) po listiću.` : ""}
                  </Text>
                  {options.map((o, oi) => (
                    <View key={oi} style={st.row}>
                      <Text style={st.cellWide}>{o}</Text>
                      <Text style={st.cell}>{r.counts[oi]}</Text>
                    </View>
                  ))}
                  <Text>
                    Važećih listića: {r.valid}, nevažećih: {r.invalid}.
                  </Text>
                  {r.roll && (
                    <View style={st.roll}>
                      {options.map((o, oi) => {
                        const names = r.roll!.filter((v) => v.choices?.includes(oi)).map((v) => v.name);
                        return names.length ? <Text key={oi}>{o}: {names.join(", ")}</Text> : null;
                      })}
                      {r.roll.some((v) => !v.choices) && (
                        <Text>Nevažeći listići: {r.roll.filter((v) => !v.choices).map((v) => v.name).join(", ")}</Text>
                      )}
                    </View>
                  )}
                  {r.adopted !== null && (
                    <Text style={{ fontWeight: "bold" }}>
                      Odluka {r.adopted ? "JE USVOJENA" : "NIJE USVOJENA"} (potrebno: {FRACTION[q.majorityFraction]}{" "}
                      {BASE[q.majorityBase]}).
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={st.h2}>Verifikacijsko povjerenstvo</Text>
        <Text>{committee.map((c) => (c.role ? `${c.name} (${ROLE[c.role].toLowerCase()})` : c.name)).join(", ")}</Text>
        <Text>
          Glasove je prebrojalo povjerenstvo dešifriranjem listića uz sudjelovanje najmanje {a.threshold} {clanova(a.threshold)}. Zapisnik
          se pečati potpisima najmanje {a.threshold} {clanova(a.threshold)} povjerenstva
          {roleList.length ? `, među kojima su ${roleList.join(" i ")}` : ""} (
          {a.sealMethod === "own_keys"
            ? "elektronički potpisi ključevima povjerenstva, provjera na /verify"
            : "kvalificirani elektronički potpisi"}
          ).
        </Text>
        <View style={st.signature}>
          {signers.map((c) => (
            <Text key={c.name} style={st.line}>
              {c.role ? ROLE[c.role] : "Član povjerenstva"}: {c.name}
            </Text>
          ))}
        </View>
      </Page>

      {numbered.length > 0 && (
        <Page size="A4" style={st.page}>
          <Text style={st.h2}>Prilog: potvrde glasačkih listića</Text>
          <Text>
            Svaki birač je pri glasovanju dobio potvrdu (SHA-256 šifriranog listića). Ako je vaša potvrda na popisu, vaš je
            listić prebrojan.
          </Text>
          {numbered.map(({ q, r, receipts, itemTitle }) => (
            <View key={q.id}>
              <Text style={st.h3}>
                {itemTitle}: {q.text}
              </Text>
              <Text style={st.receipt}>SHA-256 popisa potvrda: {r.receiptsDigest}</Text>
              {receipts.map((x) => (
                <Text key={x} style={st.receipt}>
                  {x}
                </Text>
              ))}
            </View>
          ))}
        </Page>
      )}
    </Document>
  );
}

export async function renderZapisnik(assemblyId: string) {
  return Sentry.startSpan({ name: "render zapisnik", op: "pdf.render", attributes: { assemblyId } }, async () => {
    const data = await load(assemblyId);
    const pdf = await renderToBuffer(<Zapisnik {...data} />);
    logger.info("zapisnik rendered", {
      assemblyId,
      bytes: pdf.length,
      items: data.agenda.length,
      questions: data.agenda.reduce((n, g) => n + g.questions.length, 0),
      attendees: data.attendees.length,
    });
    return pdf;
  });
}
