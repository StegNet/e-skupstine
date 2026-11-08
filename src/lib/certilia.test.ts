import { expect, test } from "bun:test";
import { certiliaClaims, certiliaOib } from "./certilia";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

test("Certilia's ID token carries the OIB as sub", () => {
  const claims = certiliaClaims(jwt({ sub: "11111111119", given_name: "Ana", family_name: "Horvat" }));
  expect(claims.given_name).toBe("Ana");
  expect(certiliaOib(claims)).toBe("11111111119");
});

test("no OIB without a valid one in sub", () => {
  expect(certiliaOib({ sub: "3b241101-e2bb-4255-8caf-4136c566a962", pin: "11111111119" })).toBeNull();
  expect(certiliaOib({ sub: "11111111111" })).toBeNull(); // wrong check digit
  expect(certiliaOib(certiliaClaims(null))).toBeNull();
});
