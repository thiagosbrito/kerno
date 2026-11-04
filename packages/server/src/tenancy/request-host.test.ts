import { describe, expect, it } from "vitest";
import { getRequestHost, type HeaderReader } from "./request-host";

const headers = (init: Record<string, string>): HeaderReader => {
  const map = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
};

describe("getRequestHost (no trusted proxy)", () => {
  it("uses the Host header", () => {
    expect(getRequestHost(headers({ host: "Store-A.localhost:3001" }), {})).toEqual({ ok: true, hostname: "store-a.localhost", source: "host" });
  });

  it("ignores every forwarded header: forwarded-host abuse does not change the host", () => {
    const attack = headers({
      host: "store-a.localhost",
      "x-forwarded-host": "store-b.localhost",
      forwarded: "host=store-b.localhost",
      "x-original-host": "store-b.localhost",
      "x-host": "store-b.localhost",
      "x-forwarded-server": "store-b.localhost",
      origin: "https://store-b.localhost",
      referer: "https://store-b.localhost/",
      "x-kerno-store-id": "20000000-0000-4000-8000-0000000000b1",
    });
    expect(getRequestHost(attack, {})).toMatchObject({ ok: true, hostname: "store-a.localhost" });
  });

  it("fails closed on missing, malformed or multi-valued Host", () => {
    expect(getRequestHost(headers({}), {})).toEqual({ ok: false, reason: "missing_host" });
    expect(getRequestHost(headers({ host: "a.localhost, b.localhost" }), {})).toEqual({ ok: false, reason: "ambiguous_host" });
    for (const host of ["127.0.0.1", "localhost", "a.localhost@evil.test", "[::1]", "a b.test", ""]) {
      expect(getRequestHost(headers({ host }), {}), host).toEqual({ ok: false, reason: "invalid_host" });
    }
  });
});

describe("getRequestHost (trusted proxy header configured)", () => {
  const policy = { trustedHostHeader: "x-forwarded-host" };

  it("uses only the trusted header and ignores Host", () => {
    const h = headers({ host: "internal.service.local", "x-forwarded-host": "shop.example.com" });
    expect(getRequestHost(h, policy)).toEqual({ ok: true, hostname: "shop.example.com", source: "trusted_header" });
    expect(getRequestHost(headers({ host: "shop.example.com", "x-forwarded-host": "other.example.com" }), policy)).toMatchObject({ hostname: "other.example.com" });
  });

  it("fails closed when the trusted header is absent instead of falling back to Host", () => {
    expect(getRequestHost(headers({ host: "shop.example.com" }), policy)).toEqual({ ok: false, reason: "missing_host" });
  });

  it("rejects an appended client-supplied value (comma list) as ambiguous", () => {
    const h = headers({ "x-forwarded-host": "evil.test, shop.example.com" });
    expect(getRequestHost(h, policy)).toEqual({ ok: false, reason: "ambiguous_host" });
  });

  it("ignores other forwarded headers even when one is trusted", () => {
    const h = headers({ "x-forwarded-host": "a.example.com", forwarded: "host=b.example.com", "x-original-host": "c.example.com" });
    expect(getRequestHost(h, policy)).toMatchObject({ hostname: "a.example.com" });
  });
});
