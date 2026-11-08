// Checks one new PAdES signature appended to a PDF we generated (Certilia app / websign flow).
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { UserError } from "./errors";

export type PdfSigner = { oib: string | null; name: string };

const OID_SERIAL_NUMBER = "2.5.4.5";
const OID_COMMON_NAME = "2.5.4.3";

export async function verifyAppendedSignature(prev: Uint8Array, next: Uint8Array): Promise<PdfSigner> {
  // A PDF signature is an incremental update, so the previous version must be an exact prefix.
  if (next.length <= prev.length || !Buffer.from(next.subarray(0, prev.length)).equals(Buffer.from(prev))) {
    throw new UserError("pdfModified");
  }
  const text = Buffer.from(next).toString("latin1");
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m;
  if (!last || last.index < prev.length) throw new UserError("pdfNoNewSignature");

  const [a, b, c, d] = last.slice(1).map(Number);
  // The signature must cover everything up to and including the previous version.
  // shortcut: bytes after c+d (e.g. LTV data added by the signer) are not checked here; Adobe/EU DSS flag later changes for recipients.
  if (a !== 0 || b >= c || c + d > next.length || c + d < prev.length) throw new UserError("pdfBadByteRange");

  const signed = Buffer.concat([next.subarray(a, a + b), next.subarray(c, c + d)]);
  const hex = text.slice(b, c).replace(/[<>\s]/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new UserError("pdfBadSignature");
  const der = Uint8Array.from(Buffer.from(hex, "hex"));
  const asn = asn1js.fromBER(der);
  if (asn.offset === -1) throw new UserError("pdfBadSignature");

  let result: pkijs.SignedDataVerifyResult;
  try {
    const content = new pkijs.ContentInfo({ schema: asn.result });
    const sd = new pkijs.SignedData({ schema: content.content });
    result = await sd.verify({
      signer: 0,
      data: signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
      // shortcut: no EU Trusted List chain check here; recipients verify the QES chain in Adobe Reader / EU DSS.
      checkChain: false,
      extendedMode: true,
    });
  } catch {
    throw new UserError("pdfBadSignature");
  }
  if (!result.signatureVerified || !result.signerCertificate) throw new UserError("pdfBadSignature");

  const attrs = result.signerCertificate.subject.typesAndValues;
  const get = (oid: string) => {
    const v = attrs.find((t) => t.type === oid)?.value.valueBlock as { value?: unknown } | undefined;
    return typeof v?.value === "string" ? v.value : undefined;
  };
  // Croatian qualified certificates are expected to carry the OIB as "PNOHR-<OIB>" in serialNumber (confirm in the M0 spike).
  const oib = get(OID_SERIAL_NUMBER)?.match(/\d{11}/)?.[0] ?? null;
  return { oib, name: get(OID_COMMON_NAME) ?? "" };
}
