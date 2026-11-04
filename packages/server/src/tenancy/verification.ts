import { Resolver } from "node:dns/promises";
import { HOSTNAME_MAX_LENGTH, HOSTNAME_PATTERN } from "@kerno/contracts";

/** A merchant proves control of a hostname by publishing this TXT record in its DNS. */
export const VERIFICATION_LABEL = "_kerno-verification";
export const VERIFICATION_VALUE_PREFIX = "kerno-verification=";

const TOKEN = /^[0-9a-f]{64}$/;

export type ResolveTxt = (name: string) => Promise<string[][]>;

export function verificationRecordName(hostname: string): string | null {
  if (hostname.length > HOSTNAME_MAX_LENGTH - VERIFICATION_LABEL.length - 1) return null;
  if (!HOSTNAME_PATTERN.test(hostname)) return null;
  return `${VERIFICATION_LABEL}.${hostname}`;
}

export function expectedVerificationValue(token: string): string {
  return `${VERIFICATION_VALUE_PREFIX}${token}`;
}

/**
 * True only if `_kerno-verification.<hostname>` has a TXT record exactly equal to
 * `kerno-verification=<token>`. Any resolver error (NXDOMAIN, timeout, SERVFAIL) is "not
 * verified". This is evidence of DNS control only; the caller still calls
 * public.confirm_domain, where the database picks the first verified claim.
 */
export async function verifyDomainOwnership(input: {
  readonly hostname: string;
  readonly token: string;
  readonly resolveTxt: ResolveTxt;
}): Promise<boolean> {
  const name = verificationRecordName(input.hostname);
  if (name === null || !TOKEN.test(input.token)) return false;
  try {
    const records = await input.resolveTxt(name);
    const expected = expectedVerificationValue(input.token);
    return records.some((chunks) => chunks.join("") === expected);
  } catch {
    return false;
  }
}

/** Real DNS lookup with a short timeout and a single attempt. */
export function createNodeTxtResolver(timeoutMs = 3000): ResolveTxt {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  return (name) => resolver.resolveTxt(name);
}
