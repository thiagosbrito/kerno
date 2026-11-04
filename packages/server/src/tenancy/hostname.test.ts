import { describe, expect, it } from "vitest";
import { normalizeHostname } from "./hostname";

describe("normalizeHostname", () => {
  it.each([
    ["shop.example.com", "shop.example.com"],
    ["SHOP.Example.COM", "shop.example.com"],
    ["shop.example.com:443", "shop.example.com"],
    ["shop.example.com:8080", "shop.example.com"],
    ["shop.example.com.", "shop.example.com"], // single trailing dot (FQDN)
    ["Shop.Example.Com.:3000", "shop.example.com"],
    ["acme-sneakers.localhost:3001", "acme-sneakers.localhost"],
    ["bücher.example.com", "xn--bcher-kva.example.com"], // IDN → punycode
    ["xn--bcher-kva.example.com", "xn--bcher-kva.example.com"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it.each([
    "", // empty
    " ",
    " shop.example.com", // surrounding whitespace
    "shop.example.com ",
    "shop.example.com\r\nX-Injected: 1", // header injection
    "shop.example.com\n",
    "user@shop.example.com", // userinfo
    "shop.example.com@evil.test",
    "evil.test#@shop.example.com",
    "shop.example.com/path",
    "shop.example.com?x=1",
    "shop.example.com#frag",
    "shop.example.com\\evil.test",
    "http://shop.example.com", // a URL, not a host
    "shop.example.com:abc",
    "shop.example.com:0",
    "shop.example.com:65536",
    "shop.example.com:99999999",
    "shop.example.com:80:80",
    "shop.example.com..", // double trailing dot
    "shop..example.com", // empty label
    ".shop.example.com", // leading dot
    ".",
    "localhost", // single label
    "127.0.0.1", // IPv4
    "127.0.0.1:3000",
    "0x7f.1",
    "2130706433", // decimal IPv4
    "[::1]", // IPv6 literal
    "[::1]:3000",
    "::1",
    "-bad.example.com",
    "bad-.example.com",
    "bad_name.example.com",
    "shop.example.1", // numeric TLD
    `${"a".repeat(64)}.example.com`, // label too long
    `${"a.".repeat(130)}com`, // name too long
    "shop.example.com\u0000",
    "shop.exa\u0000mple.com",
    "sh op.example.com",
  ])("rejects %j", (input) => {
    expect(normalizeHostname(input)).toBeNull();
  });

  it("maps look-alike spellings to one canonical host, never to another store's host", () => {
    const canonical = normalizeHostname("shop.example.com");
    for (const variant of ["SHOP.EXAMPLE.COM", "shop.example.com.", "shop.example.com:443", "Shop.Example.Com:80"]) {
      expect(normalizeHostname(variant)).toBe(canonical);
    }
    expect(normalizeHostname("shop.example.com.evil.test")).toBe("shop.example.com.evil.test");
    expect(normalizeHostname("shop.example.com.evil.test")).not.toBe(canonical);
  });
});
