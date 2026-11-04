import { describe, expect, it } from "vitest";
import { expectedVerificationValue, verificationRecordName, verifyDomainOwnership } from "./verification";

const token = "a".repeat(64);
const host = "shop.acme-sneakers.test";

describe("domain ownership verification", () => {
  it("accepts the exact TXT record, including multi-chunk values", async () => {
    const value = expectedVerificationValue(token);
    const calls: string[] = [];
    const resolveTxt = async (name: string) => {
      calls.push(name);
      return [["v=spf1 -all"], [value.slice(0, 20), value.slice(20)]];
    };
    expect(await verifyDomainOwnership({ hostname: host, token, resolveTxt })).toBe(true);
    expect(calls).toEqual([`_kerno-verification.${host}`]);
  });

  it.each([
    ["wrong token", [[`kerno-verification=${"b".repeat(64)}`]]],
    ["prefix only", [["kerno-verification="]]],
    ["extra suffix", [[`kerno-verification=${token}x`]]],
    ["extra prefix", [[` kerno-verification=${token}`]]],
    ["different label", [[`other=${token}`]]],
    ["no records", []],
  ])("rejects %s", async (_n, records) => {
    expect(await verifyDomainOwnership({ hostname: host, token, resolveTxt: async () => records })).toBe(false);
  });

  it("treats resolver errors as not verified", async () => {
    const resolveTxt = async () => {
      throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await verifyDomainOwnership({ hostname: host, token, resolveTxt })).toBe(false);
  });

  it("refuses malformed hostnames and tokens without any lookup", async () => {
    let called = false;
    const resolveTxt = async () => {
      called = true;
      return [[expectedVerificationValue(token)]];
    };
    for (const hostname of ["Shop.Example.Test", "127.0.0.1", "a..b.test", "x.test\n"]) {
      expect(await verifyDomainOwnership({ hostname, token, resolveTxt })).toBe(false);
    }
    expect(await verifyDomainOwnership({ hostname: host, token: "short", resolveTxt })).toBe(false);
    expect(called).toBe(false);
    expect(verificationRecordName(`${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.test`)).toBeNull();
  });
});
