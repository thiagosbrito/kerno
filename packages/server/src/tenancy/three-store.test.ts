import { describe, expect, it } from "vitest";
import type { ResolvedStore } from "@kerno/contracts";
import { tenantCacheKey } from "./cache";
import { createStoreResolver, type StoreDirectory, type StoreLookup } from "./resolver";

// THI-67: three stores under concurrent, interleaved load (including hostile hosts) never
// receive each other's resolution, and tenant cache keys stay disjoint.
const mk = (n: number, slug: string): ResolvedStore => ({ storeId: `20000000-0000-4000-8000-0000000000e${n}`, slug, canonicalHostname: null });
const stores = [mk(1, "acme-sneakers"), mk(2, "acme-books"), mk(3, "acme-plants")];

function slowDirectory(): StoreDirectory {
  const jitter = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 5)));
  return {
    async byHost(): Promise<StoreLookup> {
      await jitter();
      return { status: "not_found" };
    },
    async bySlug(slug): Promise<StoreLookup> {
      await jitter();
      const s = stores.find((x) => x.slug === slug);
      return s ? { status: "found", store: s } : { status: "not_found" };
    },
  };
}

describe("concurrent requests across three tenants", () => {
  it("never cross-resolves under interleaved load, with fresh and warm caches", async () => {
    for (const ttl of [0, 30_000]) {
      const resolver = createStoreResolver({ directory: slowDirectory(), platformDomain: "localhost", cache: { positiveTtlMs: ttl } });
      const hosts = ["acme-sneakers.localhost", "acme-books.localhost", "acme-plants.localhost", "acme-draft.localhost", "x.acme-books.localhost"];
      const jobs = Array.from({ length: 300 }, (_, i) => hosts[(i * 7) % hosts.length] ?? "");
      const results = await Promise.all(jobs.map((h) => resolver.resolve(h)));
      results.forEach((r, i) => {
        const h = (jobs[i] ?? "").toLowerCase();
        const expected = stores.find((s) => h.startsWith(s.slug + "."));
        if (expected) expect(r.kind === "store" && r.store.storeId, h).toBe(expected.storeId);
        else expect(r.kind === "store", h).toBe(false);
      });
    }
  });
});

describe("tenant cache keys across three stores", () => {
  it("are pairwise distinct for identical scope, version, locale and currency", () => {
    const keys = stores.map((s) => tenantCacheKey({ storeId: s.storeId, scope: "homepage", publicationVersion: "v1", locale: "en", currency: "USD" }));
    expect(new Set(keys).size).toBe(3);
  });

  it("do not let one store's key be forged through another part", () => {
    const [a, b] = stores as [ResolvedStore, ResolvedStore];
    const forged = tenantCacheKey({ storeId: a.storeId, scope: `homepage","${b.storeId}`, locale: "en" });
    expect(forged).not.toBe(tenantCacheKey({ storeId: b.storeId, scope: "homepage", locale: "en" }));
    expect(() => tenantCacheKey({ storeId: `${a.storeId}/../${b.storeId}`, scope: "homepage" })).toThrow();
  });
});
