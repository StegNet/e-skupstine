import { describe, expect, test } from "bun:test";
import { signPdf } from "../../tests/pdf-signer";
import { verifyAppendedSignature } from "./pdf-signature";

const enc = new TextEncoder();

describe("verifyAppendedSignature", () => {
  const prev = enc.encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");

  test("accepts a valid appended signature and reads the OIB", async () => {
    const next = await signPdf(prev);
    expect(await verifyAppendedSignature(prev, next)).toEqual({ oib: "12345678903", name: "Ana Anić" });
  });

  test("rejects a file whose earlier content changed", async () => {
    const next = await signPdf(prev);
    next[3] ^= 1;
    await expect(verifyAppendedSignature(prev, next)).rejects.toThrow("pdfModified");
  });

  test("rejects a signature that no longer matches the signed bytes", async () => {
    const next = await signPdf(prev);
    const i = new TextDecoder("latin1").decode(next).indexOf("/Type /Sig");
    next[i + 2] ^= 1;
    await expect(verifyAppendedSignature(prev, next)).rejects.toThrow("pdfBadSignature");
  });

  test("rejects an upload with no new signature", async () => {
    const next = enc.encode(new TextDecoder("latin1").decode(prev) + "\n% comment\n");
    await expect(verifyAppendedSignature(prev, next)).rejects.toThrow("pdfNoNewSignature");
  });
});
