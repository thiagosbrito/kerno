import { describe, expect, it } from "vitest";
import { isOriginAllowed, toOriginSet } from "./origin";

const policy = { allowedOrigins: toOriginSet(["https://admin.kerno.test/some/path", "not a url"]) };
const headers = (h: Record<string, string>) => new Headers(h);

describe("isOriginAllowed", () => {
  it("normalizes configured URLs and drops invalid ones", () => {
    expect([...policy.allowedOrigins]).toEqual(["https://admin.kerno.test"]);
  });

  it("lets safe methods through and requires an exact origin for mutations", () => {
    expect(isOriginAllowed("GET", headers({}), policy)).toBe(true);
    expect(isOriginAllowed("PATCH", headers({ origin: "https://admin.kerno.test" }), policy)).toBe(true);
    for (const origin of ["https://evil.test", "null", "http://admin.kerno.test", "https://admin.kerno.test.evil.test", "https://admin.kerno.test:8443"]) {
      expect(isOriginAllowed("PATCH", headers({ origin }), policy), origin).toBe(false);
    }
  });

  it("without Origin accepts only a proven same-origin fetch", () => {
    expect(isOriginAllowed("DELETE", headers({ "sec-fetch-site": "same-origin" }), policy)).toBe(true);
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(isOriginAllowed("DELETE", headers({ "sec-fetch-site": site }), policy)).toBe(false);
    }
    expect(isOriginAllowed("DELETE", headers({}), policy)).toBe(false);
  });

  it("denies everything when no origin is configured", () => {
    expect(isOriginAllowed("POST", headers({ origin: "https://admin.kerno.test" }), { allowedOrigins: toOriginSet([]) })).toBe(false);
  });
});
