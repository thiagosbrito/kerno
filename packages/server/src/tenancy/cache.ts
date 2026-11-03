export interface CacheOptions {
  readonly maxEntries: number;
  readonly positiveTtlMs: number;
  readonly negativeTtlMs: number;
  readonly now: () => number;
}

export const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  maxEntries: 1000,
  positiveTtlMs: 30_000,
  negativeTtlMs: 5_000,
  now: () => Date.now(),
};

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

/**
 * Small bounded TTL cache. Bounded because negative entries are keyed by attacker-chosen
 * hostnames: without a cap, random Host values would grow memory without limit. Oldest entries
 * are evicted first. Entries are per process; a domain release or store suspension takes effect
 * within one TTL.
 */
export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(key: string): { readonly hit: true; readonly value: V } | { readonly hit: false } {
    const entry = this.entries.get(key);
    if (entry === undefined) return { hit: false };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TenantCacheKeyParts {
  readonly storeId: string;
  /** What is cached, for example "homepage" or "catalog". */
  readonly scope: string;
  readonly publicationVersion?: string | undefined;
  readonly locale?: string | undefined;
  readonly currency?: string | undefined;
}

/**
 * Key for any tenant-scoped cache (data cache, CDN surrogate key, in-memory). The store id is
 * mandatory and validated, and the parts are encoded as a JSON array so no value can forge
 * another part (no separator ambiguity). Never build tenant cache keys by hand.
 */
export function tenantCacheKey(parts: TenantCacheKeyParts): string {
  if (!UUID.test(parts.storeId)) throw new Error("tenantCacheKey requires a store id");
  if (parts.scope.length === 0) throw new Error("tenantCacheKey requires a scope");
  return JSON.stringify([
    "kerno:v1",
    parts.storeId,
    parts.scope,
    parts.publicationVersion ?? null,
    parts.locale ?? null,
    parts.currency ?? null,
  ]);
}
