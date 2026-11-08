// Ballot crypto shared by the browser (voters, committee) and the server (tally check).
// Each ballot gets its own AES key K; K is Shamir-split k-of-n and each share is
// ECIES-encrypted (ECDH P-256 + HKDF + AES-GCM) to one committee member. No master key exists.
import { combine, split } from "shamir-secret-sharing";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
// Fixed plaintext size so ciphertext length does not leak which options were chosen.
const PAYLOAD_SIZE = 256;

export const b64 = (u: Uint8Array) => {
  let s = "";
  for (const byte of u) s += String.fromCharCode(byte);
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function sha256Hex(data: string | Uint8Array) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type KeyFile = {
  v: 1;
  assemblyId: string;
  userId: string;
  enc: JsonWebKey;
  sign?: JsonWebKey;
};

export async function generateCommitteeKeys(assemblyId: string, userId: string, withSigning: boolean) {
  const encPair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const signPair = withSigning ? await subtle.generateKey(ECDSA, true, ["sign", "verify"]) : null;
  const file: KeyFile = {
    v: 1,
    assemblyId,
    userId,
    enc: await subtle.exportKey("jwk", encPair.privateKey),
    sign: signPair ? await subtle.exportKey("jwk", signPair.privateKey) : undefined,
  };
  return {
    file,
    encPublic: await subtle.exportKey("jwk", encPair.publicKey),
    signPublic: signPair ? await subtle.exportKey("jwk", signPair.publicKey) : null,
  };
}

async function shareKey(priv: CryptoKey, pub: CryptoKey) {
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hkdf = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("e-skupstina/share/v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aesKey = (raw: Uint8Array, usage: KeyUsage) =>
  subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [usage]);

type WrappedShare = { epk: string; iv: string; ct: string };
export type Bundle = { v: 1; iv: string; ct: string; shares: WrappedShare[] };

async function wrapShare(share: Uint8Array, recipient: JsonWebKey, aad: BufferSource): Promise<WrappedShare> {
  const pub = await subtle.importKey("jwk", recipient, ECDH, false, []);
  const eph = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const iv = random(12);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    await shareKey(eph.privateKey, pub),
    share as BufferSource,
  );
  return {
    epk: b64(new Uint8Array(await subtle.exportKey("raw", eph.publicKey))),
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  };
}

/** Encrypts a ballot for the committee (keys in committee position order). Returns the exact JSON text that is stored and hashed into the receipt. */
export async function encryptBallot(
  questionId: string,
  choices: number[],
  committeeKeys: JsonWebKey[],
  threshold: number,
): Promise<string> {
  const aad = enc.encode(questionId);
  const k = random(32);
  const payload = enc.encode(JSON.stringify({ c: choices }).padEnd(PAYLOAD_SIZE, " "));
  const iv = random(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await aesKey(k, "encrypt"), payload);
  const shares = await split(k, committeeKeys.length, threshold);
  const wrapped = await Promise.all(shares.map((s, i) => wrapShare(s, committeeKeys[i], aad)));
  const bundle: Bundle = { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)), shares: wrapped };
  return JSON.stringify(bundle);
}

/** Committee member: decrypts their own share of every ballot. Ballots whose share does not decrypt are skipped (they end up invalid). */
export async function unwrapMyShares(
  questionId: string,
  ballots: { id: string; bundle: string }[],
  myIndex: number,
  encPrivate: JsonWebKey,
): Promise<Record<string, string>> {
  const priv = await subtle.importKey("jwk", encPrivate, ECDH, false, ["deriveBits"]);
  const aad = enc.encode(questionId);
  const out: Record<string, string> = {};
  for (const b of ballots) {
    try {
      const w = (JSON.parse(b.bundle) as Bundle).shares[myIndex];
      const pub = await subtle.importKey("raw", unb64(w.epk) as BufferSource, ECDH, false, []);
      const share = await subtle.decrypt(
        { name: "AES-GCM", iv: unb64(w.iv) as BufferSource, additionalData: aad },
        await shareKey(priv, pub),
        unb64(w.ct) as BufferSource,
      );
      out[b.id] = b64(new Uint8Array(share));
    } catch {
      // Malformed or tampered share: leave it out.
    }
  }
  return out;
}

function* subsets<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < items.length; i++) yield* subsets(items, k, i + 1, [...acc, items[i]]);
}

/** Rebuilds K from any k shares that work. Trying subsets means one bad committee share cannot spoil a ballot. */
async function openBallot(bundle: string, shares: Uint8Array[], threshold: number, aad: BufferSource) {
  let parsed: Bundle;
  try {
    parsed = JSON.parse(bundle);
  } catch {
    return null;
  }
  for (const subset of subsets(shares, threshold)) {
    try {
      const k = await combine(subset);
      const pt = await subtle.decrypt(
        { name: "AES-GCM", iv: unb64(parsed.iv) as BufferSource, additionalData: aad },
        await aesKey(k, "decrypt"),
        unb64(parsed.ct) as BufferSource,
      );
      return (JSON.parse(new TextDecoder().decode(pt)) as { c: unknown }).c;
    } catch {
      // Wrong combination or corrupt data: try the next subset.
    }
  }
  return null;
}

export type TallyQuestion = { id: string; optionsCount: number; maxChoices: number; threshold: number };
export type Tally = { counts: number[]; valid: number; invalid: number };

export function isValidChoice(c: unknown, q: Pick<TallyQuestion, "optionsCount" | "maxChoices">): c is number[] {
  return (
    Array.isArray(c) &&
    c.length >= 1 &&
    c.length <= q.maxChoices &&
    new Set(c).size === c.length &&
    c.every((x) => Number.isInteger(x) && x >= 0 && x < q.optionsCount)
  );
}

/** Decrypts and counts. Same code runs in each committee browser and on the server, so results can be compared. */
export async function tallyBallots(
  q: TallyQuestion,
  ballots: { id: string; bundle: string }[],
  submissions: Record<string, string>[],
): Promise<Tally & { choices: Record<string, number[] | null> }> {
  const aad = enc.encode(q.id);
  const counts = new Array<number>(q.optionsCount).fill(0);
  let valid = 0;
  let invalid = 0;
  // Per ballot id (null = invalid); used for the roll of public votes.
  const perBallot: Record<string, number[] | null> = {};
  for (const b of ballots) {
    const shares = submissions.flatMap((s) => (s[b.id] ? [unb64(s[b.id])] : []));
    const choices = await openBallot(b.bundle, shares, q.threshold, aad);
    if (isValidChoice(choices, q)) {
      valid++;
      for (const c of choices) counts[c]++;
      perBallot[b.id] = choices;
    } else {
      invalid++;
      perBallot[b.id] = null;
    }
  }
  return { counts, valid, invalid, choices: perBallot };
}

export async function receiptsDigest(receipts: string[]) {
  return sha256Hex([...receipts].sort().join("\n"));
}

export async function signBytes(signPrivate: JsonWebKey, data: Uint8Array) {
  const key = await subtle.importKey("jwk", signPrivate, ECDSA, false, ["sign"]);
  return b64(new Uint8Array(await subtle.sign(ECDSA_SIGN, key, data as BufferSource)));
}

export async function verifyBytes(signPublic: JsonWebKey, data: Uint8Array, signature: string) {
  try {
    const key = await subtle.importKey("jwk", signPublic, ECDSA, false, ["verify"]);
    return await subtle.verify(ECDSA_SIGN, key, unb64(signature) as BufferSource, data as BufferSource);
  } catch {
    return false;
  }
}
