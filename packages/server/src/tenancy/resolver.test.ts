import { describe, expect, it } from "vitest";
import type { ResolvedStore } from "@kerno/contracts";
import { createStoreResolver, type StoreDirectory, type StoreLookup } from "./resolver";
import { routeRequest } from "./route-request";
import type { HeaderReader } from "./request-host";

const PLATFORM = "localhost";
const store = (n: number, slug: string, canonicalHostname: string | null = null): ResolvedStore => ({
  storeId: `20000000-0000-4000-8000-0000000000e${n}`,
  slug,
  canonicalHostname,
});
const sneakers = store(1, "acme-sneakers", "shop.acme-sneakers.test");
const books = store(2, "acme-books");
const plants = store(3, "acme-plants");

/** In-memory stand-in for the database: three active stores, one verified custom host. */
function fakeDirectory(overrides: { outage?: () => boolean } = {}) {
  const calls: string[] = [];
  const bySlugMap = new Map([sneakers, books, plants].map((s) => [s.slug, s]));
  const byHostMap = new Map([["shop.acme-sneakers.test", sneakers]]);
  const directory: StoreDirectory = {
    async byHost(h): Promise<StoreLookup> {
      calls.push(`host:${h}`);
      if (overrides.outage?.()) return { status: "unavailable" };
      const s = byHostMap.get(h);
      return s ? { status: "found", store: s } : { status: "not_found" };
    },
    async bySlug(slug): Promise<StoreLookup> {
      calls.push(`slug:${slug}`);
      if (overrides.outage?.()) return { status: "unavailable" };
      const s = bySlugMap.get(slug);
      return s ? { status: "found", store: s } : { status: "not_found" };
    },
  };
  return { directory, calls, bySlugMap, byHostMap };
}

const headers = (init: Record<string, string>): HeaderReader => {
  const map = new Map(Object.entries(init).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (n) => map.get(n.toLowerCase()) ?? null };
};

describe("one deployment serves three seeded stores", () => {
  it("routes each host to its own store", async () => {
    const { directory } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    const policy = {};
    const a = await routeRequest(headers({ host: "acme-sneakers.localhost:3001" }), { policy, resolver });
    const b = await routeRequest(headers({ host: "acme-books.localhost:3001" }), { policy, resolver });
    const c = await routeRequest(headers({ host: "acme-plants.localhost:3001" }), { policy, resolver });
    const d = await routeRequest(headers({ host: "shop.acme-sneakers.test" }), { policy, resolver });
    expect([a, b, c, d].map((r) => (r.action === "serve" ? r.resolution.store.storeId : r.action))).toEqual([
      sneakers.storeId,
      books.storeId,
      plants.storeId,
      sneakers.storeId,
    ]);
    expect(a.action === "serve" && a.resolution.canonicalHostname).toBe("shop.acme-sneakers.test");
    expect(b.action === "serve" && b.resolution.canonicalHostname).toBe("acme-books.localhost");
    expect(d.action === "serve" && d.resolution.hostKind).toBe("custom");
  });
});

describe("unknown and unverified hosts cannot resolve a store", () => {
  it.each([
    "localhost", // platform apex
    "nope.localhost", // unknown slug
    "a.acme-books.localhost", // nested subdomain
    "acme-books.localhost.evil.test", // lookalike suffix
    "evil-acme-books.test", // unrelated host
    "pending.acme-books.test", // pending claim: directory returns nothing
    "-bad.localhost",
    "x.localhost", // slug too short
  ])("%s → not_found", async (host) => {
    const { directory } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    expect(await resolver.resolve(host)).toEqual({ kind: "unknown" });
  });

  it("never queries the directory for apex or nested platform names", async () => {
    const { directory, calls } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    await resolver.resolve("localhost");
    await resolver.resolve("a.b.localhost");
    expect(calls).toEqual([]);
  });

  it("rejects a directory that answers with a different store than the slug asked for", async () => {
    const directory: StoreDirectory = {
      byHost: async () => ({ status: "not_found" }),
      bySlug: async () => ({ status: "found", store: plants }),
    };
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    expect(await resolver.resolve("acme-books.localhost")).toEqual({ kind: "unknown" });
  });
});

describe("host-header spoofing and forwarded-host abuse", () => {
  it("serves the Host header's store even if forwarded headers name another store", async () => {
    const { directory } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    const decision = await routeRequest(
      headers({ host: "acme-books.localhost", "x-forwarded-host": "acme-sneakers.localhost", forwarded: "host=acme-plants.localhost" }),
      { policy: {}, resolver },
    );
    expect(decision.action === "serve" && decision.resolution.store.slug).toBe("acme-books");
  });

  it("with a trusted header configured, Host is ignored and an unknown trusted host is not_found", async () => {
    const { directory } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    const policy = { trustedHostHeader: "x-forwarded-host" };
    const spoof = await routeRequest(headers({ host: "acme-books.localhost", "x-forwarded-host": "evil.test" }), { policy, resolver });
    expect(spoof).toEqual({ action: "not_found", reason: "unknown_host" });
    const missing = await routeRequest(headers({ host: "acme-books.localhost" }), { policy, resolver });
    expect(missing).toEqual({ action: "not_found", reason: "missing_host" });
  });

  it.each(["acme-books.localhost, evil.test", "127.0.0.1", "acme-books.localhost@evil.test", ""])("rejects Host %j", async (host) => {
    const { directory, calls } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    const decision = await routeRequest(headers({ host }), { policy: {}, resolver });
    expect(decision.action).toBe("not_found");
    expect(calls).toEqual([]);
  });
});

describe("cache behavior", () => {
  it("shares one entry across case, port and trailing-dot spellings of a host", async () => {
    const { directory, calls } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    const policy = {};
    for (const host of ["acme-books.localhost", "ACME-BOOKS.localhost:3001", "acme-books.localhost."]) {
      await routeRequest(headers({ host }), { policy, resolver });
    }
    expect(calls).toEqual(["slug:acme-books"]);
  });

  it("never reuses one store's entry for another store (cross-store reuse)", async () => {
    const { directory } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    const first = await resolver.resolve("acme-books.localhost");
    const second = await resolver.resolve("acme-plants.localhost");
    const third = await resolver.resolve("acme-books.localhost");
    expect(first.kind === "store" && first.store.slug).toBe("acme-books");
    expect(second.kind === "store" && second.store.slug).toBe("acme-plants");
    expect(third).toEqual(first);
  });

  it("cannot be poisoned: a spoofed forwarded host never creates an entry for the victim host", async () => {
    const { directory, calls } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    // Attacker sends Host: evil.test with X-Forwarded-Host naming the victim; policy ignores it.
    await routeRequest(headers({ host: "evil.test", "x-forwarded-host": "acme-books.localhost" }), { policy: {}, resolver });
    expect(calls).toEqual(["host:evil.test"]);
    // The victim host still resolves correctly and independently afterwards.
    const victim = await resolver.resolve("acme-books.localhost");
    expect(victim.kind === "store" && victim.store.slug).toBe("acme-books");
  });

  it("caches negatives briefly, then re-checks (a newly verified domain appears within the negative TTL)", async () => {
    let now = 0;
    const { directory, calls, byHostMap } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM, cache: { now: () => now, negativeTtlMs: 5_000, positiveTtlMs: 30_000 } });
    expect(await resolver.resolve("shop.acme-books.test")).toEqual({ kind: "unknown" });
    byHostMap.set("shop.acme-books.test", books);
    expect(await resolver.resolve("shop.acme-books.test")).toEqual({ kind: "unknown" }); // still cached
    now = 5_000;
    expect((await resolver.resolve("shop.acme-books.test")).kind).toBe("store");
    expect(calls.filter((c) => c === "host:shop.acme-books.test")).toHaveLength(2);
  });

  it("stops serving a released domain after the positive TTL", async () => {
    let now = 0;
    const { directory, byHostMap } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM, cache: { now: () => now, positiveTtlMs: 30_000 } });
    expect((await resolver.resolve("shop.acme-sneakers.test")).kind).toBe("store");
    byHostMap.delete("shop.acme-sneakers.test");
    now = 29_999;
    expect((await resolver.resolve("shop.acme-sneakers.test")).kind).toBe("store");
    now = 30_000;
    expect((await resolver.resolve("shop.acme-sneakers.test")).kind).toBe("unknown");
  });

  it("does not cache directory outages, so an outage never becomes a cached 404", async () => {
    let down = true;
    const { directory } = fakeDirectory({ outage: () => down });
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    expect(await resolver.resolve("acme-books.localhost")).toEqual({ kind: "unavailable" });
    down = false;
    expect((await resolver.resolve("acme-books.localhost")).kind).toBe("store");
  });

  it("maps an outage to 'unavailable' (503), not 'not_found'", async () => {
    const { directory } = fakeDirectory({ outage: () => true });
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM });
    expect(await routeRequest(headers({ host: "acme-books.localhost" }), { policy: {}, resolver })).toEqual({ action: "unavailable" });
  });

  it("stays bounded under many random hosts", async () => {
    const { directory } = fakeDirectory();
    const resolver = createStoreResolver({ directory, platformDomain: PLATFORM, cache: { maxEntries: 20 } });
    for (let i = 0; i < 500; i++) await resolver.resolve(`rnd-${i}.example.test`);
    // No assertion on internals beyond "does not throw and still resolves correctly".
    expect((await resolver.resolve("acme-books.localhost")).kind).toBe("store");
  });
});
