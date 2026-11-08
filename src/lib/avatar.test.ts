import { describe, expect, test } from "bun:test";
import { inlinePhoto, sniffImage } from "./avatar";

// 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("profile photos", () => {
  test("accepts a data URI or bare base64 image, typed by its bytes", () => {
    expect(inlinePhoto(`data:image/jpeg;base64,${PNG}`)?.contentType).toBe("image/png");
    expect(inlinePhoto(PNG)?.contentType).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  test("refuses SVG, HTML and junk, which could run as a page", () => {
    const b64 = (t: string) => Buffer.from(t).toString("base64");
    expect(inlinePhoto(`data:image/svg+xml;base64,${b64("<svg onload=alert(1)>")}`)).toBeNull();
    expect(inlinePhoto(b64("<html><script>alert(1)</script>"))).toBeNull();
    expect(inlinePhoto("not a photo")).toBeNull();
  });
});
