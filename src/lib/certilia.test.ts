import { afterEach, expect, mock, test } from "bun:test";
import { certiliaClaims } from "./certilia";

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const realFetch = globalThis.fetch;
process.env.CERTILIA_DISCOVERY_URL = "https://idp.test/.well-known/openid-configuration";

// Certilia: discovery works; userinfo answers with `userinfo`.
function certilia(userinfo: Response) {
  const fetchMock = mock(async (url: string | URL | Request) =>
    String(url).endsWith("openid-configuration")
      ? Response.json({ userinfo_endpoint: "https://idp.test/userinfo" })
      : userinfo,
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("uses the ID token alone when it has the wanted claim", async () => {
  const fetchMock = certilia(new Response(null, { status: 500 }));
  const claims = await certiliaClaims({ accessToken: "t", idToken: jwt({ sub: "s1", pin: "12345678903" }) }, ["pin"]);
  expect(claims).toEqual({ sub: "s1", pin: "12345678903" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("adds userinfo claims when the ID token lacks the wanted claim", async () => {
  certilia(Response.json({ sub: "s1", pin: "12345678903" }));
  const claims = await certiliaClaims({ accessToken: "t", idToken: jwt({ sub: "s1", name: "Ana" }) }, ["pin"]);
  expect(claims).toEqual({ sub: "s1", name: "Ana", pin: "12345678903" });
});

test("keeps the ID token claims when userinfo fails", async () => {
  certilia(new Response("<html>400 Bad Request</html>", { status: 400 }));
  const claims = await certiliaClaims({ accessToken: "t", idToken: jwt({ sub: "s1" }) }, ["pin"]);
  expect(claims).toEqual({ sub: "s1" });
});
