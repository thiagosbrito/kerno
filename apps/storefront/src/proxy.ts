import { getStoreRouter } from "@kerno/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * First gate for every storefront request: the host must resolve to an ACTIVE store through a
 * verified claim or a platform subdomain (THI-65, docs/security/host-routing.md). Unknown or
 * unverified hosts get a generic 404 that does not reveal why; a lookup outage fails closed
 * with 503. Pages re-resolve the store themselves, so this proxy is not the only check.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const decision = await getStoreRouter().route(request.headers);
  if (decision.action === "serve") return NextResponse.next();
  const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
  if (decision.action === "unavailable") {
    return new NextResponse("Service temporarily unavailable", { status: 503, headers: { ...headers, "Retry-After": "5" } });
  }
  return new NextResponse("Not found", { status: 404, headers });
}

export const config = {
  // Everything except Next's static asset routes, which carry no tenant data. The image
  // optimizer is gated too; THI-74 must revisit it once images become store-specific.
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
