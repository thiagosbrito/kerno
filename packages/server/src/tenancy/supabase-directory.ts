import { publicStoreProfileSchema, resolvedStoreSchema, type PublicStoreProfile } from "@kerno/contracts";
import { z } from "zod";
import type { StoreDirectory, StoreLookup } from "./resolver";

export type ProfileLookup =
  | { readonly status: "found"; readonly profile: PublicStoreProfile }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable" };

export interface SupabaseDirectoryOptions {
  /** Project URL (NEXT_PUBLIC_SUPABASE_URL). */
  readonly url: string;
  /** Anon/publishable key only. The request path never needs the service role. */
  readonly anonKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface SupabaseDirectory extends StoreDirectory {
  profile(storeId: string): Promise<ProfileLookup>;
}

const rows = z.array(z.unknown()).max(1);

/**
 * Reads the public host-resolution functions and the public profile projection through the
 * Data API with the anon key, exactly as any anonymous client could. Everything else about
 * tenants stays behind RLS. Any transport error, non-2xx status, timeout or malformed body is
 * "unavailable" (fail closed, never cached by the resolver), not "not found".
 */
export function createSupabaseDirectory(options: SupabaseDirectoryOptions): SupabaseDirectory {
  const base = options.url.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2000;
  const headers = {
    apikey: options.anonKey,
    Authorization: `Bearer ${options.anonKey}`,
    Accept: "application/json",
  };

  async function request(path: string, init: RequestInit): Promise<unknown[] | null> {
    try {
      const response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) return null;
      const parsed = rows.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function rpc(name: string, args: Record<string, string>): Promise<StoreLookup> {
    const data = await request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (data === null) return { status: "unavailable" };
    const row = data[0];
    if (row === undefined) return { status: "not_found" };
    const parsed = resolvedStoreSchema.safeParse(row);
    return parsed.success ? { status: "found", store: parsed.data } : { status: "unavailable" };
  }

  return {
    byHost: (hostname) => rpc("resolve_store_by_host", { host: hostname }),
    bySlug: (slug) => rpc("resolve_store_by_slug", { store_slug: slug }),
    async profile(storeId) {
      if (!z.uuid().safeParse(storeId).success) return { status: "not_found" };
      const select = "display_name,default_locale,currency,homepage_mode";
      const data = await request(`/rest/v1/store_public_profiles?select=${select}&store_id=eq.${storeId}`, { method: "GET" });
      if (data === null) return { status: "unavailable" };
      const row = data[0];
      if (row === undefined) return { status: "not_found" };
      const parsed = publicStoreProfileSchema.safeParse(row);
      return parsed.success ? { status: "found", profile: parsed.data } : { status: "unavailable" };
    },
  };
}
