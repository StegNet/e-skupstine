import { expect, test } from "bun:test";
import { getIP } from "@better-auth/core/utils/ip";

process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
const { auth } = await import("./auth");
const ip = (headers: Record<string, string>) => getIP(new Request("https://e.test/api/auth/sign-in/social", { headers }), auth.options);

test("rate limits see the visitor, not the proxies in front of the app", () => {
  // Cloudflare → Traefik on a Swarm overlay network → app.
  expect(ip({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" })).toBe("203.0.113.7");
  // An address the visitor wrote into X-Forwarded-For themselves is ignored.
  expect(ip({ "x-forwarded-for": "198.51.100.9, 203.0.113.7, 10.0.0.2" })).toBe("203.0.113.7");
  // CLIENT_IP_HEADER wins: Traefik's peer may be a Cloudflare edge, not the visitor.
  expect(ip({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "203.0.113.8, 172.71.1.1" })).toBe("203.0.113.8");
});
