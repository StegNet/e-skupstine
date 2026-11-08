import { describe, expect, test } from "bun:test";
import {
  b64,
  encryptBallot,
  generateCommitteeKeys,
  signBytes,
  tallyBallots,
  unwrapMyShares,
  verifyBytes,
} from "./ballot-crypto";

const Q = "11111111-1111-1111-1111-111111111111";

async function setup() {
  const committee = await Promise.all([0, 1, 2].map((i) => generateCommitteeKeys("a", `u${i}`, true)));
  const pubs = committee.map((c) => c.encPublic);
  const votes = [[0], [0], [1], [2], [0]];
  const ballots = await Promise.all(
    votes.map(async (c, i) => ({ id: `b${i}`, bundle: await encryptBallot(Q, c, pubs, 2) })),
  );
  return { committee, pubs, ballots };
}

const q = { id: Q, optionsCount: 3, maxChoices: 1, threshold: 2 };

describe("ballot crypto", () => {
  test("any 2 of 3 committee members can tally; one cannot", async () => {
    const { committee, ballots } = await setup();
    const shares = await Promise.all(committee.map((c, i) => unwrapMyShares(Q, ballots, i, c.file.enc)));

    for (const pair of [[0, 1], [0, 2], [1, 2]]) {
      const t = await tallyBallots(q, ballots, pair.map((i) => shares[i]));
      expect(t).toMatchObject({ counts: [3, 1, 1], valid: 5, invalid: 0 });
    }
    const alone = await tallyBallots(q, ballots, [shares[0]]);
    expect(alone.valid).toBe(0);
  });

  test("a corrupted share from one member does not spoil ballots when others are present", async () => {
    const { committee, ballots } = await setup();
    const shares = await Promise.all(committee.map((c, i) => unwrapMyShares(Q, ballots, i, c.file.enc)));
    const bad = Object.fromEntries(Object.keys(shares[1]).map((k) => [k, b64(new Uint8Array(33).fill(7))]));
    const t = await tallyBallots(q, ballots, [shares[0], bad, shares[2]]);
    expect(t).toMatchObject({ counts: [3, 1, 1], valid: 5, invalid: 0 });
  });

  test("ballots moved to another question, out-of-range choices and garbage count as invalid", async () => {
    const { committee, pubs, ballots } = await setup();
    const moved = { id: "moved", bundle: await encryptBallot("other-question", [0], pubs, 2) };
    const outOfRange = { id: "oor", bundle: await encryptBallot(Q, [7], pubs, 2) };
    const tooMany = { id: "many", bundle: await encryptBallot(Q, [0, 1], pubs, 2) };
    const garbage = { id: "junk", bundle: "{not json" };
    const all = [...ballots, moved, outOfRange, tooMany, garbage];
    const shares = await Promise.all(committee.map((c, i) => unwrapMyShares(Q, all, i, c.file.enc)));
    const t = await tallyBallots(q, all, shares);
    expect(t).toMatchObject({ counts: [3, 1, 1], valid: 5, invalid: 4 });
  });

  test("ciphertext length does not depend on the choice", async () => {
    const { pubs } = await setup();
    const a = JSON.parse(await encryptBallot(Q, [0], pubs, 2)).ct.length;
    const b = JSON.parse(await encryptBallot(Q, [0, 1, 2, 10, 11], pubs, 2)).ct.length;
    expect(a).toBe(b);
  });

  test("own_keys signatures verify only for the signed bytes and key", async () => {
    const [m1, m2] = await Promise.all([generateCommitteeKeys("a", "x", true), generateCommitteeKeys("a", "y", true)]);
    const pdf = new TextEncoder().encode("%PDF-1.7 zapisnik");
    const sig = await signBytes(m1.file.sign!, pdf);
    expect(await verifyBytes(m1.signPublic!, pdf, sig)).toBe(true);
    expect(await verifyBytes(m2.signPublic!, pdf, sig)).toBe(false);
    expect(await verifyBytes(m1.signPublic!, new TextEncoder().encode("%PDF-1.7 zapisniK"), sig)).toBe(false);
  });
});
