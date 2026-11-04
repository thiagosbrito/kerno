"use server";

import { loginInputSchema, safeRedirectPath } from "@kerno/contracts";
import { signInWithPassword } from "@kerno/server";
import { redirect } from "next/navigation";
import { assertSameOrigin, requestAuth } from "../../lib/auth";

export interface LoginState {
  readonly error?: string;
}

const GENERIC = "Invalid email or password.";

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const auth = await requestAuth();
  if (!(await assertSameOrigin(auth.allowedOrigins))) {
    auth.log({ event: "auth.login", correlationId: auth.correlationId, outcome: "denied", reason: "origin_not_allowed" });
    return { error: "This request could not be verified. Reload the page and try again." };
  }

  const parsed = loginInputSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  // Same message for malformed input and wrong credentials: no account enumeration.
  if (!parsed.success) return { error: GENERIC };

  const result = await signInWithPassword(auth.client, parsed.data);
  if (result.status !== "signed_in") {
    // Never log the email or password; the reason is the result class only.
    auth.log({ event: "auth.login", correlationId: auth.correlationId, outcome: "denied", reason: result.status });
    if (result.status === "rate_limited") return { error: "Too many attempts. Wait a moment and try again." };
    if (result.status === "unavailable") return { error: "Sign-in is temporarily unavailable. Try again shortly." };
    return { error: GENERIC };
  }
  auth.log({ event: "auth.login", correlationId: auth.correlationId, outcome: "allowed", reason: "signed_in" });
  redirect(safeRedirectPath(formData.get("next")));
}
