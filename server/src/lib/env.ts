// ── Boot environment validation ─────────────────────────────────────────────
// Pure over an injected env map so tests can drive every shape without
// touching process.env. index.ts keeps the behavior: log + exit(1) when
// anything required is missing.

/** Vars the server refuses to boot without. Production additionally needs
 *  the Redis REST pair (queue/sessions) and the SERVICE_TOKEN identity
 *  boundary — without the latter every org/email/auth/me route 403s, so
 *  booting would serve a dead API. */
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
