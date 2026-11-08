// Test helper: appends a PAdES-like detached CMS signature to a PDF, like the Certilia app would.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const enc = new TextEncoder();

async function selfSignedCert(serialNumber: string, cn: string) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });
  for (const target of [cert.subject, cert.issuer]) {
    target.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: cn }) }),
      new pkijs.AttributeTypeAndValue({ type: "2.5.4.5", value: new asn1js.PrintableString({ value: serialNumber }) }),
    );
  }
  cert.notBefore.value = new Date();
  cert.notAfter.value = new Date(Date.now() + 86_400_000);
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  return { cert, keys };
}

/** Appends an incremental update holding a detached CMS signature over the ByteRange to the (binary) prev PDF. */
export async function signPdf(prev: Uint8Array, serialNumber = "PNOHR-12345678903", cn = "Ana Anić") {
  const { cert, keys } = await selfSignedCert(serialNumber, cn);
  const pad = (n: number) => String(n).padEnd(10, " ");
  const tail = (br: number[], hex: string) =>
    `\n2 0 obj << /Type /Sig /ByteRange [${br.map(pad).join(" ")}] /Contents <${hex}> >> endobj\n%%EOF\n`;
  const withTail = (t: string) => new Uint8Array([...prev, ...enc.encode(t)]);
  const placeholder = "0".repeat(8192);
  const draft = tail([0, 0, 0, 0], placeholder);
  const b = prev.length + draft.indexOf("/Contents <") + "/Contents ".length;
  const c = b + placeholder.length + 2;
  const byteRange = [0, b, c, prev.length + draft.length - c];
  const unsigned = withTail(tail(byteRange, placeholder));
  const data = new Uint8Array([...unsigned.subarray(0, b), ...unsigned.subarray(c)]);

  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.7.1" }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      }),
    ],
    certificates: [cert],
  });
  await sd.sign(keys.privateKey, 0, "SHA-256", data.buffer as ArrayBuffer);
  const der = new pkijs.ContentInfo({ contentType: pkijs.ContentInfo.SIGNED_DATA, content: sd.toSchema(true) })
    .toSchema()
    .toBER();
  const hex = Buffer.from(der).toString("hex").padEnd(placeholder.length, "0");
  return withTail(tail(byteRange, hex));
}

