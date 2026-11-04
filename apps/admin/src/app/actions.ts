"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertSameOrigin, requestAuth } from "../lib/auth";

export async function logout(): Promise<void> {
  const auth = await requestAuth();
  if (!(await assertSameOrigin(auth.allowedOrigins))) {
    auth.log({ event: "auth.logout", correlationId: auth.correlationId, outcome: "denied", reason: "origin_not_allowed" });
    redirect("/");
  }
  // Revokes this session's refresh token at the auth server, so a copied cookie stops working.
  const { error } = await auth.client.auth.signOut({ scope: "local" });
  // Clear the cookies regardless: logging out must work even if the auth server is unreachable.
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith("sb-")) store.delete(name);
  }
  auth.log({ event: "auth.logout", correlationId: auth.correlationId, outcome: error ? "error" : "allowed", reason: error ? "revoke_failed" : "signed_out" });
  redirect("/login");
}
