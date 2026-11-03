import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

/** Browser-safe configuration. Only NEXT_PUBLIC_* names belong here. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_ADMIN_URL: httpUrl,
  NEXT_PUBLIC_STOREFRONT_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/** Server-only configuration. Never import this module's server schema into client code. */
export const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/**
 * Host routing configuration (storefront only).
 * PLATFORM_DOMAIN: the suffix under which stores get a subdomain (`<slug>.<PLATFORM_DOMAIN>`), e.g.
 * `localhost` in development. TRUSTED_FORWARDED_HOST_HEADER: name of the one header, set by the
 * trusted edge/proxy, that carries the public hostname. Unset (the default) means only the Host
 * header is used and every X-Forwarded-* header is ignored.
 */
export const hostRoutingEnvSchema = z.object({
  PLATFORM_DOMAIN: z
    .string()
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/),
  TRUSTED_FORWARDED_HOST_HEADER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^x-[a-z0-9-]{1,60}$/).optional(),
  ),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type HostRoutingEnv = z.infer<typeof hostRoutingEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join("; ")}`);
    this.name = "EnvError";
    this.issues = issues;
  }
}

function parse<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Report variable names and reasons only; never echo submitted values.
    throw new EnvError(result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return result.data;
}

export const parsePublicEnv = (source: Record<string, string | undefined>): PublicEnv =>
  parse(publicEnvSchema, source);
export const parseServerEnv = (source: Record<string, string | undefined>): ServerEnv =>
  parse(serverEnvSchema, source);
export const parseHostRoutingEnv = (source: Record<string, string | undefined>): HostRoutingEnv =>
  parse(hostRoutingEnvSchema, source);
