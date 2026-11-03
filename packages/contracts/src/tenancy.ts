import { z } from "zod";

/** Mirrors the CHECK on public.store_domains.hostname: normalized ASCII, 2+ labels, letter-led TLD. */
export const HOSTNAME_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const HOSTNAME_MAX_LENGTH = 253;
/** Mirrors the CHECK on public.stores.slug. */
export const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const hostname = z.string().max(HOSTNAME_MAX_LENGTH).regex(HOSTNAME_PATTERN);

/** Slugs that cannot be stores because they would become <slug>.<platform domain>. Mirrors the CHECK stores_slug_not_reserved. */
export const RESERVED_STORE_SLUGS: readonly string[] = ["www", "api", "app", "admin", "auth", "login", "logout", "signup", "register", "account", "accounts", "billing", "checkout", "cdn", "assets", "static", "media", "mail", "email", "smtp", "ftp", "status", "support", "help", "docs", "blog", "dashboard", "console", "kerno", "platform", "root", "staging", "preview"];

/** Row returned by public.resolve_store_by_host / resolve_store_by_slug. Only these fields are public. */
export const resolvedStoreSchema = z
  .object({
    store_id: z.uuid(),
    slug: z.string().regex(STORE_SLUG_PATTERN),
    canonical_hostname: hostname.nullable(),
  })
  .strict()
  .transform((row) => ({
    storeId: row.store_id,
    slug: row.slug,
    canonicalHostname: row.canonical_hostname,
  }));
export type ResolvedStore = z.output<typeof resolvedStoreSchema>;

/** Public storefront projection (store_public_profiles); deliberately excludes every private field. */
export const publicStoreProfileSchema = z
  .object({
    display_name: z.string().min(1).max(120),
    default_locale: z.enum(["en", "pt-BR", "pl"]),
    currency: z.enum(["USD", "BRL", "PLN"]),
    homepage_mode: z.enum(["landing", "catalog"]),
  })
  .strict()
  .transform((row) => ({
    displayName: row.display_name,
    defaultLocale: row.default_locale,
    currency: row.currency,
    homepageMode: row.homepage_mode,
  }));
export type PublicStoreProfile = z.output<typeof publicStoreProfileSchema>;
