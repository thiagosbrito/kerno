import { getRequestHost, type HeaderReader, type HostPolicy } from "./request-host";
import type { Resolution, StoreResolver } from "./resolver";

export type StoreResolution = Extract<Resolution, { kind: "store" }>;

export type RouteDecision =
  | { readonly action: "serve"; readonly resolution: StoreResolution }
  /** `reason` is for logs and metrics only; never put it in a response body. */
  | { readonly action: "not_found"; readonly reason: "missing_host" | "invalid_host" | "ambiguous_host" | "unknown_host" }
  | { readonly action: "unavailable" };

export interface RouteDependencies {
  readonly policy: HostPolicy;
  readonly resolver: StoreResolver;
}

/** The single decision point for "which store is this request for?". Framework-agnostic. */
export async function routeRequest(headers: HeaderReader, deps: RouteDependencies): Promise<RouteDecision> {
  const host = getRequestHost(headers, deps.policy);
  if (!host.ok) return { action: "not_found", reason: host.reason };
  const resolution = await deps.resolver.resolve(host.hostname);
  if (resolution.kind === "store") return { action: "serve", resolution };
  if (resolution.kind === "unavailable") return { action: "unavailable" };
  return { action: "not_found", reason: "unknown_host" };
}
