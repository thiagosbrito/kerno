import { RESERVED_STORE_SLUGS, STORE_SLUG_PATTERN, type ResolvedStore } from "@kerno/contracts";
import { BoundedTtlCache, DEFAULT_CACHE_OPTIONS, type CacheOptions } from "./cache";

export type StoreLookup =
  | { readonly status: "found"; readonly store: ResolvedStore }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable" };

/** The only way the request path learns about stores. Implementations must return ACTIVE stores only. */
export interface StoreDirectory {
  byHost(hostname: string): Promise<StoreLookup>;
  bySlug(slug: string): Promise<StoreLookup>;
}

export type Resolution =
  | {
      readonly kind: "store";
      readonly store: ResolvedStore;
      readonly hostname: string;
      readonly hostKind: "platform" | "custom";
      /** Where the store prefers to be addressed: its verified primary domain, else its platform subdomain. */
      readonly canonicalHostname: string;
    }
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable" };

export interface StoreResolver {
  /** `hostname` must already be normalized (see normalizeHostname). */
  resolve(hostname: string): Promise<Resolution>;
}

export interface ResolverOptions {
  readonly directory: StoreDirectory;
  /** Platform suffix, lowercase, no dots at the ends (for example "kerno.app" or "localhost"). */
  readonly platformDomain: string;
  readonly cache?: Partial<CacheOptions>;
}

type CachedLookup = Extract<StoreLookup, { status: "found" | "not_found" }>;

/**
 * Hostname → store. Fails closed: the platform apex, nested or malformed subdomains, and every
 * host the directory does not return an active store for resolve to "unknown". Directory
 * outages resolve to "unavailable" and are never cached (so an outage cannot become a cached
 * 404). The cache is keyed by the normalized hostname only, so two stores can never share an
 * entry, and nothing derived from a forwarded header ever reaches it.
 */
export function createStoreResolver(options: ResolverOptions): StoreResolver {
  const opts: CacheOptions = { ...DEFAULT_CACHE_OPTIONS, ...options.cache };
  const cache = new BoundedTtlCache<CachedLookup>(opts.maxEntries, opts.now);
  const suffix = `.${options.platformDomain}`;
  const inflight = new Map<string, Promise<StoreLookup>>();

  async function lookup(key: string, run: () => Promise<StoreLookup>): Promise<StoreLookup> {
    const cached = cache.get(key);
    if (cached.hit) return cached.value;
    // Concurrent misses for one host share a single directory call.
    const pending = inflight.get(key);
    if (pending !== undefined) return pending;
    const call = (async () => {
      const result = await run();
      if (result.status === "found") cache.set(key, result, opts.positiveTtlMs);
      else if (result.status === "not_found") cache.set(key, result, opts.negativeTtlMs);
      return result;
    })().finally(() => inflight.delete(key));
    inflight.set(key, call);
    return call;
  }

  return {
    async resolve(hostname) {
      if (hostname === options.platformDomain) return { kind: "unknown" };

      let hostKind: "platform" | "custom";
      let result: StoreLookup;
      if (hostname.endsWith(suffix)) {
        const label = hostname.slice(0, -suffix.length);
        if (label.includes(".") || !STORE_SLUG_PATTERN.test(label) || RESERVED_STORE_SLUGS.includes(label)) return { kind: "unknown" };
        hostKind = "platform";
        result = await lookup(hostname, () => options.directory.bySlug(label));
        // Defense in depth against a directory that answers for a different store.
        if (result.status === "found" && result.store.slug !== label) return { kind: "unknown" };
      } else {
        hostKind = "custom";
        result = await lookup(hostname, () => options.directory.byHost(hostname));
      }

      if (result.status === "unavailable") return { kind: "unavailable" };
      if (result.status === "not_found") return { kind: "unknown" };
      const { store } = result;
      return {
        kind: "store",
        store,
        hostname,
        hostKind,
        canonicalHostname: store.canonicalHostname ?? `${store.slug}${suffix}`,
      };
    },
  };
}
