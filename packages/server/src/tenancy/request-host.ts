import { normalizeHostname } from "./hostname";

export interface HeaderReader {
  get(name: string): string | null;
}

export interface HostPolicy {
  /**
   * Lowercase name of the ONE header set by the trusted edge/proxy that carries the public
   * hostname (for example `x-forwarded-host`). Leave undefined when the app is reached
   * directly: then only `Host` is used and every forwarded header is ignored.
   */
  readonly trustedHostHeader?: string | undefined;
}

export type RequestHost =
  | { readonly ok: true; readonly hostname: string; readonly source: "host" | "trusted_header" }
  | { readonly ok: false; readonly reason: "missing_host" | "invalid_host" | "ambiguous_host" };

/**
 * Derives the requested hostname from exactly one header. A client can set any header, so a
 * forwarded header is honored only when the deployment names it as trusted, which is only
 * correct if the edge overwrites it (never appends to a client-supplied value). When a trusted
 * header is configured but absent, the request fails closed instead of falling back to Host.
 * A comma-separated or otherwise multi-valued header is ambiguous and rejected.
 */
export function getRequestHost(headers: HeaderReader, policy: HostPolicy): RequestHost {
  const name = policy.trustedHostHeader ?? "host";
  const raw = headers.get(name);
  if (raw === null) return { ok: false, reason: "missing_host" };
  if (raw.includes(",")) return { ok: false, reason: "ambiguous_host" };
  const hostname = normalizeHostname(raw);
  if (hostname === null) return { ok: false, reason: "invalid_host" };
  return { ok: true, hostname, source: policy.trustedHostHeader === undefined ? "host" : "trusted_header" };
}
