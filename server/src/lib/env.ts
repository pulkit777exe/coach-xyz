// ── Boot environment validation ─────────────────────────────────────────────
// Pure over an injected env map (tests drive every shape). index.ts keeps
// the behavior: log + exit(1) when anything required is missing.

/** Vars the server refuses to boot without. In production the Redis pair
 *  and SERVICE_TOKEN join: without the latter every guarded route 403s. */
export const requiredEnvVars = (nodeEnv: string | undefined): string[] => [
  'ENGINE_URL',
  ...(nodeEnv === 'production'
    ? ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SERVICE_TOKEN']
    : []),
]

/** Names from `requiredEnvVars(nodeEnv)` that are missing or empty in `env`. */
export const missingEnvVars = (
  env: Record<string, string | undefined>,
  nodeEnv: string | undefined,
): string[] => requiredEnvVars(nodeEnv).filter((k) => !env[k])
