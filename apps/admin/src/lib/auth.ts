import { createRequestAuth, isOriginAllowed } from "@kerno/server";
import { cookies, headers } from "next/headers";

/**
 * Per-request auth context bound to this request's cookies (never module-level state).
 * Cookie writes are best-effort in server components; the proxy refreshes the session.
 */
export async function requestAuth() {
  const store = await cookies();
  return createRequestAuth({
    getAll: () => store.getAll(),
    setAll: (list) => {
      for (const c of list) store.set(c.name, c.value, c.options);
    },
  });
}

/** Explicit origin check for server actions, on top of Next.js's built-in Origin/Host comparison. */
export async function assertSameOrigin(allowedOrigins: ReadonlySet<string>): Promise<boolean> {
  return isOriginAllowed("POST", await headers(), { allowedOrigins });
}
