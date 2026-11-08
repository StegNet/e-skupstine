import { describe, expect, test } from "bun:test";
import { isValidOib, parseDate, parseMembers } from "./members";
import { isAdopted, quorumMet } from "./rules";

describe("rules", () => {
  test("quorum is strictly more than the percentage", () => {
    expect(quorumMet(5, 10, 50)).toBe(false);
    expect(quorumMet(6, 10, 50)).toBe(true);
    expect(quorumMet(1, 10, 0)).toBe(true);
    expect(quorumMet(0, 10, 0)).toBe(false);
  });

  const motion = { kind: "motion", presentAtOpen: 10, eligibleAtOpen: 20 } as const;
  test("simple majority of votes cast is strict", () => {
    const q = { ...motion, majorityBase: "votes_cast", majorityFraction: "half" } as const;
    expect(isAdopted(q, [5, 5, 0], 10)).toBe(false);
    expect(isAdopted(q, [6, 3, 1], 10)).toBe(true);
  });
  test("two-thirds of present and of all members", () => {
    expect(isAdopted({ ...motion, majorityBase: "present", majorityFraction: "two_thirds" }, [7, 0, 0], 7)).toBe(true);
    expect(isAdopted({ ...motion, majorityBase: "present", majorityFraction: "two_thirds" }, [6, 0, 0], 6)).toBe(false);
    expect(isAdopted({ ...motion, majorityBase: "members", majorityFraction: "half" }, [10, 0, 0], 10)).toBe(false);
  });
  test("elections have no adopted flag", () => {
    expect(isAdopted({ ...motion, kind: "election", majorityBase: "votes_cast", majorityFraction: "half" }, [3, 2], 5)).toBeNull();
  });
});

describe("members", () => {
  test("OIB check digit", () => {
    expect(isValidOib("12345678903")).toBe(true);
    expect(isValidOib("12345678904")).toBe(false);
    expect(isValidOib("1234567890")).toBe(false);
  });

  test("dates in ISO and Croatian format", () => {
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect(parseDate("1.3.2024.")).toBe("2024-03-01");
    expect(parseDate("31.2.2024")).toBeUndefined();
    expect(parseDate("")).toBeNull();
  });

  test("CSV with semicolons, quotes, BOM and per-line errors", () => {
    const csv =
      '﻿oib;ime_prezime;email;pravo_glasa;datum_pristupanja\r\n' +
      '12345678903;"Horvat; Ana";ana@example.hr;da;1.1.2020.\r\n' +
      "12345678904;Kovač Ivo;;da;\r\n" +
      "12345678903;Duplikat;;;\r\n";
    const { members, errors } = parseMembers(csv);
    expect(members).toEqual([
      {
        oib: "12345678903",
        fullName: "Horvat; Ana",
        email: "ana@example.hr",
        category: null,
        dateOfBirth: null,
        joinedAt: "2020-01-01",
        leftAt: null,
        votingRight: true,
      },
    ]);
    expect(errors).toEqual([
      { line: 3, message: "invalidOib" },
      { line: 4, message: "duplicateOib" },
    ]);
  });

  test("missing required columns", () => {
    expect(parseMembers("email,name\nx@y.hr,Ana").errors[0].message).toBe("missingColumns");
  });

  test("statut categories decide the voting right", () => {
    const cats = { redovni: true, "podupirući": false };
    const csv =
      "oib;ime_prezime;kategorija;pravo_glasa\n" +
      "12345678903;Ana;Redovni član;\n" +
      "11111111119;Ivo;podupiruci;\n" +
      "22222222226;Eva;počasni;\n" +
      "33333333335;Iva;podupirući;da\n" +
      "55555555551;Bez Kategorije;;\n";
    const { members, errors } = parseMembers(csv, cats);
    expect(members.map((m) => [m.fullName, m.votingRight])).toEqual([
      ["Ana", true],
      ["Ivo", false],
    ]);
    expect(errors).toEqual([
      { line: 4, message: "unknownCategory" },
      { line: 5, message: "votingRightConflict" },
      { line: 6, message: "unknownCategory" },
    ]);
  });
});
