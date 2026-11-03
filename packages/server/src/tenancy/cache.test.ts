import { describe, expect, it } from "vitest";
import { BoundedTtlCache, tenantCacheKey } from "./cache";

describe("BoundedTtlCache", () => {
  it("expires entries and evicts the oldest beyond the cap", () => {
    let now = 0;
    const cache = new BoundedTtlCache<number>(3, () => now);
    cache.set("a", 1, 100);
    cache.set("b", 2, 100);
    cache.set("c", 3, 100);
    cache.set("d", 4, 100); // evicts a
    expect(cache.get("a").hit).toBe(false);
    expect(cache.get("d")).toEqual({ hit: true, value: 4 });
    expect(cache.size).toBe(3);
    now = 100;
    expect(cache.get("d").hit).toBe(false);
    expect(cache.size).toBe(2);
  });

  it("stays bounded under attacker-chosen keys", () => {
    const cache = new BoundedTtlCache<number>(50, () => 0);
    for (let i = 0; i < 10_000; i++) cache.set(`random-${i}.example.com`, i, 1000);
    expect(cache.size).toBe(50);
  });
});

describe("tenantCacheKey", () => {
  const a = "20000000-0000-4000-8000-0000000000a1";
  const b = "20000000-0000-4000-8000-0000000000b1";

  it("never collides across stores, scopes, versions, locales or currencies", () => {
    const keys = [
      tenantCacheKey({ storeId: a, scope: "home" }),
      tenantCacheKey({ storeId: b, scope: "home" }),
      tenantCacheKey({ storeId: a, scope: "catalog" }),
      tenantCacheKey({ storeId: a, scope: "home", publicationVersion: "v2" }),
      tenantCacheKey({ storeId: a, scope: "home", locale: "pl" }),
      tenantCacheKey({ storeId: a, scope: "home", currency: "PLN" }),
      tenantCacheKey({ storeId: a, scope: "home", locale: "pl", currency: "PLN" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cannot be forged through separator characters in a part", () => {
    const forged = tenantCacheKey({ storeId: a, scope: 'home","x', locale: "pl" });
    const honest = tenantCacheKey({ storeId: a, scope: "home", publicationVersion: "x", locale: "pl" });
    expect(forged).not.toBe(honest);
    expect(JSON.parse(forged)).toHaveLength(6);
  });

  it("requires a valid store id and a scope", () => {
    expect(() => tenantCacheKey({ storeId: "", scope: "home" })).toThrow();
    expect(() => tenantCacheKey({ storeId: "not-a-uuid", scope: "home" })).toThrow();
    expect(() => tenantCacheKey({ storeId: a, scope: "" })).toThrow();
  });
});
