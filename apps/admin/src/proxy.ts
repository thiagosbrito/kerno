import { createSessionClient, verifySession } from "@kerno/server";
import { parsePublicEnv, safeRedirectPath } from "@kerno/contracts";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = new Set(["/login"]);

/**
 * Session gate and refresher for the admin app. It (1) verifies the session with the auth
 * server, which rotates an expiring access token and rewrites the cookies, and (2) sends
 * unauthenticated page requests to /login. It is NOT the authorization boundary: pages, server
 * actions and API routes re-check the session and the current membership themselves, because a
 * proxy can be bypassed (matcher gaps, direct route calls) and knows nothing about roles.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const env = parsePublicEnv(process.env);
  let response = NextResponse.next({ request });
  const client = createSessionClient(
    env,
    {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
    { correlationId: crypto.randomUUID().replaceAll("-", ""), production: process.env.NODE_ENV === "production" },
  );
  const session = await verifySession(client);

  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isPublicPage = PUBLIC_PAGES.has(pathname);

  if (session.status === "unavailable" && !isApi) {
    return new NextResponse("Service temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    });
  }
  if (session.status === "unauthenticated" && !isApi && !isPublicPage) {
    const target = new URL("/login", request.url);
    target.searchParams.set("next", safeRedirectPath(`${pathname}${search}`));
    return redirectKeepingCookies(target, response);
  }
  if (session.status === "authenticated" && isPublicPage) {
    return redirectKeepingCookies(new URL("/", request.url), response);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** A redirect must carry any cookies the refresh just wrote, or the user is logged out on the next hop. */
function redirectKeepingCookies(url: URL, source: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const c of source.cookies.getAll()) redirect.cookies.set(c);
  redirect.headers.set("Cache-Control", "no-store");
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
