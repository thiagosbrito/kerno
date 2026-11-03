import { z } from "zod";

/** Browser-safe configuration. Only NEXT_PUBLIC_* names belong here. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_ADMIN_URL: z.url(),
  NEXT_PUBLIC_STOREFRONT_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/** Server-only configuration. Never import this module's server schema into client code. */
export const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
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
