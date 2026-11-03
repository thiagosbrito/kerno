import "server-only";
import { parseHostRoutingEnv, parsePublicEnv } from "@kerno/contracts";
import { routeRequest, type RouteDecision } from "./route-request";
import type { HeaderReader } from "./request-host";
import { createStoreResolver } from "./resolver";
import { createSupabaseDirectory, type ProfileLookup } from "./supabase-directory";

export interface StoreRouter {
  route(headers: HeaderReader): Promise<RouteDecision>;
  profile(storeId: string): Promise<ProfileLookup>;
}

let router: StoreRouter | undefined;

/**
 * Process-wide tenant-binding resolver for the storefront (ADR 0004 rule 3): the one place
 * that turns a request's host into a store. It uses the anon key; the service role is not
 * needed on the request path and is never read here.
 */
export function getStoreRouter(): StoreRouter {
  if (router === undefined) {
    const publicEnv = parsePublicEnv(process.env);
    const routing = parseHostRoutingEnv(process.env);
    const directory = createSupabaseDirectory({
      url: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    const resolver = createStoreResolver({ directory, platformDomain: routing.PLATFORM_DOMAIN });
    const policy = { trustedHostHeader: routing.TRUSTED_FORWARDED_HOST_HEADER };
    router = {
      route: (headers) => routeRequest(headers, { policy, resolver }),
      profile: (storeId) => directory.profile(storeId),
    };
  }
  return router;
}
