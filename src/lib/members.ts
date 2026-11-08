// Popis članova (Zakon o udrugama čl. 12): CSV import with OIB validation.

/** OIB check digit, ISO 7064 MOD 11,10. */
export function isValidOib(oib: string) {
  if (!/^\d{11}$/.test(oib)) return false;
  let a = 10;
  for (let i = 0; i < 10; i++) {
    a = (a + Number(oib[i])) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  return (11 - a) % 10 === Number(oib[10]);
}

/** Minimal RFC 4180 parser; delimiter is ";" (Croatian Excel) or ",", whichever the header line uses more. */
export function parseCsv(text: string): string[][] {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const HEADERS: Record<string, keyof MemberInput> = {
  oib: "oib",
  ime_prezime: "fullName",
  name: "fullName",
  datum_rodenja: "dateOfBirth",
  date_of_birth: "dateOfBirth",
  email: "email",
  kategorija: "category",
  category: "category",
  datum_pristupanja: "joinedAt",
  joined_at: "joinedAt",
  datum_prestanka: "leftAt",
  left_at: "leftAt",
  pravo_glasa: "votingRight",
  voting_right: "votingRight",
};

export type MemberInput = {
  oib: string;
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  category: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  votingRight: boolean;
};

/** Accepts 2024-01-31 or 31.1.2024. (with or without the trailing dot). Returns ISO date, null for empty, undefined if invalid. */
export function parseDate(s: string): string | null | undefined {
  const v = s.trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = v.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return undefined;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return date.toISOString().slice(0, 10);
}

export type ParseError = { line: number; message: string };

const norm = (v: string) => v.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** `categories` (statut) maps member category to voting right; when set, the category decides who votes. */
export function parseMembers(text: string, categories: Record<string, boolean> = {}): { members: MemberInput[]; errors: ParseError[] } {
  const cats = new Map(Object.entries(categories).map(([k, v]) => [norm(k), v]));
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const errors: ParseError[] = [];
  if (!head) return { members: [], errors: [{ line: 1, message: "empty" }] };
  const cols = head.map((h) => HEADERS[h.trim().toLowerCase()]);
  if (!cols.includes("oib") || !cols.includes("fullName")) {
    return { members: [], errors: [{ line: 1, message: "missingColumns" }] };
  }
  const members: MemberInput[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const get = (k: keyof MemberInput) => (r[cols.indexOf(k)] ?? "").trim();
    const oib = get("oib");
    if (!isValidOib(oib)) return errors.push({ line, message: "invalidOib" });
    if (seen.has(oib)) return errors.push({ line, message: "duplicateOib" });
    if (!get("fullName")) return errors.push({ line, message: "missingName" });
    const email = get("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errors.push({ line, message: "invalidEmail" });
    const dates = { dateOfBirth: parseDate(get("dateOfBirth")), joinedAt: parseDate(get("joinedAt")), leftAt: parseDate(get("leftAt")) };
    if (Object.values(dates).includes(undefined)) return errors.push({ line, message: "invalidDate" });
    const vr = get("votingRight").toLowerCase();
    const explicit = vr ? !["ne", "no", "0", "false"].includes(vr) : undefined;
    let votingRight = explicit ?? true;
    if (cats.size) {
      // "Redovni član" matches "redovni".
      const fromCategory = cats.get(norm(get("category")).split(/\s+/)[0]);
      if (fromCategory === undefined) return errors.push({ line, message: "unknownCategory" });
      if (explicit !== undefined && explicit !== fromCategory) return errors.push({ line, message: "votingRightConflict" });
      votingRight = fromCategory;
    }
    seen.add(oib);
    members.push({
      oib,
      fullName: get("fullName"),
      email: email || null,
      category: get("category") || null,
      dateOfBirth: dates.dateOfBirth ?? null,
      joinedAt: dates.joinedAt ?? null,
      leftAt: dates.leftAt ?? null,
      votingRight,
    });
  });
  return { members, errors };
}
