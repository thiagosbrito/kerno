export interface OriginPolicy {
  /** Exact origins (scheme://host[:port]) allowed to send cookie-authenticated mutations. */
  readonly allowedOrigins: ReadonlySet<string>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase());

/**
 * CSRF / origin check for cookie-authenticated requests (ASVS V3). State-changing methods must
 * come from an allowed origin: the `Origin` header must match exactly. A browser that omits
 * `Origin` is accepted only when `Sec-Fetch-Site` proves a same-origin request; anything else
 * (including a missing header pair, `null` origins and cross-site/same-site requests) is denied.
 * Safe methods are never state-changing here, so they pass.
 */
export function isOriginAllowed(
  method: string,
  headers: { get(name: string): string | null },
  policy: OriginPolicy,
): boolean {
  if (isSafeMethod(method)) return true;
  const origin = headers.get("origin");
  if (origin !== null) return policy.allowedOrigins.has(origin);
  return headers.get("sec-fetch-site") === "same-origin";
}

/** Normalize configured URLs to origins; invalid values are dropped so a typo fails closed. */
export function toOriginSet(urls: readonly string[]): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      const { origin } = new URL(url);
      if (origin !== "null") origins.add(origin);
    } catch {
      // ignored on purpose: an unparsable origin allows nothing
    }
  }
  return origins;
}
