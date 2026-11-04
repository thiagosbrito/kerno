import { domainToASCII } from "node:url";
import { HOSTNAME_MAX_LENGTH, HOSTNAME_PATTERN } from "@kerno/contracts";

// host[:port] only: no whitespace, userinfo, path, query, fragment, backslash or IPv6 brackets.
const HOST_WITH_OPTIONAL_PORT = /^([^\s:/\\?#@[\]]+)(?::([0-9]{1,5}))?$/;

/**
 * Normalizes a Host-style value to the canonical form stored in `store_domains.hostname`:
 * lowercase ASCII (punycode for IDNs), no port, no single trailing dot, 2+ labels, letter-led
 * TLD. Returns null for anything else, including IP literals, userinfo/path/CRLF smuggling,
 * empty labels and over-long names. Callers must treat null as "not a hostname we serve".
 */
export function normalizeHostname(raw: string): string | null {
  if (raw.length === 0 || raw.length > HOSTNAME_MAX_LENGTH + 8) return null;
  const match = HOST_WITH_OPTIONAL_PORT.exec(raw);
  const hostPart = match?.[1];
  if (hostPart === undefined) return null;
  const port = match?.[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;

  const host = hostPart.endsWith(".") ? hostPart.slice(0, -1) : hostPart;
  if (host.length === 0 || host.endsWith(".")) return null;

  const ascii = domainToASCII(host);
  if (ascii.length === 0 || ascii.length > HOSTNAME_MAX_LENGTH) return null;
  // The same pattern the database enforces; anything unusual (IPs, underscores) stops here.
  return HOSTNAME_PATTERN.test(ascii) ? ascii : null;
}
