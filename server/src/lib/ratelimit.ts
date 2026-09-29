import { redis } from './redis'
import { readRequestMeta } from './requestMeta'
import { buildError, type CoachAIError } from './errors'
import { SERVICE_HEADERS } from './serviceGuard'
import { logger } from './logger'
import { Elysia } from 'elysia'

// Rate limiting with atomic Redis increments
// When Redis is unavailable, fail open — don't block users

interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset: number
}

// Simple in-memory rate limit fallback with eviction
const memoryLimits = new Map<string, { count: number; resetAt: number }>()
const MEMORY_LIMIT_MAX_ENTRIES = 10000

function evictExpiredMemoryLimits(): void {
  const now = Date.now()
  for (const [key, entry] of memoryLimits) {
    if (now > entry.resetAt) memoryLimits.delete(key)
  }
  if (memoryLimits.size > MEMORY_LIMIT_MAX_ENTRIES) {
    const entries = [...memoryLimits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    const toRemove = entries.slice(0, entries.length - MEMORY_LIMIT_MAX_ENTRIES / 2)
    for (const [key] of toRemove) memoryLimits.delete(key)
  }
}

function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  evictExpiredMemoryLimits()
  const now = Date.now()
  const entry = memoryLimits.get(key)
  if (!entry || now > entry.resetAt) {
    memoryLimits.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, reset: now + windowMs }
  }
  entry.count++
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, reset: entry.resetAt }
  }
  return {
    allowed: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
  }
}

interface RateLimitConfig {
  key: string
  limit: number
  windowSec: number
}

export async function checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  const { key, limit, windowSec } = config
  try {
    // Atomic increment fails over to the in-memory limiter below when Redis is down
    const result = await redis.rateLimitIncrement(key, limit, windowSec)
    return {
      allowed: result.allowed,
      remaining: Math.max(0, limit - result.current),
      reset: result.reset,
    }
  } catch (error) {
    // Fail open, but never silently: the fallback is per-process and per-replica,
    // so a Redis outage quietly weakens the limit for every user while looking
    // perfectly healthy. It is also invisible precisely when it matters most —
    // the shared serverless quota being spent makes *every* request take this
    // path, and nothing distinguished that from normal operation.
    logger.warn('rate_limit_degraded_to_memory', {
      type: 'rate_limit_degraded_to_memory',
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return memoryLimit(key, limit, windowSec * 1000)
  }
}

export async function checkScanLimit(ip: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.SCAN_RATE_LIMIT || '10')
  return checkLimit({ key: `rl:scan:${ip}`, limit, windowSec: 60 })
}

export async function checkAnalysisLimit(ip: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.ANALYSIS_RATE_LIMIT || '5')
  return checkLimit({ key: `rl:analysis:${ip}`, limit, windowSec: 3600 })
}

/** Per-IP+identity hourly cap on AI chat (paid Gemini calls). */
export async function checkChatLimit(key: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.CHAT_RATE_LIMIT || '30')
  return checkLimit({ key: `rl:chat:${key}`, limit, windowSec: 3600 })
}

/** Per-IP+identity hourly cap on video downloads. */
export async function checkDownloadLimit(key: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.DOWNLOAD_RATE_LIMIT || '60')
  return checkLimit({ key: `rl:download:${key}`, limit, windowSec: 3600 })
}

/** Per-IP per-minute cap on scan-progress SSE opens. */
export async function checkScanProgressLimit(ip: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.SCAN_PROGRESS_RATE_LIMIT || '30')
  return checkLimit({ key: `rl:scanprogress:${ip}`, limit, windowSec: 60 })
}

/** Per-org daily cap on outbound email (invites + reports + attendance). */
export async function checkEmailLimit(orgId: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.EMAIL_RATE_LIMIT || '20')
  return checkLimit({ key: `rl:email:${orgId}`, limit, windowSec: 86400 })
}

/** Per-org hourly cap on AI report generation (paid Gemini calls). */
export async function checkAiReportLimit(orgId: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.AI_REPORT_RATE_LIMIT || '10')
  return checkLimit({ key: `rl:aireport:${orgId}`, limit, windowSec: 3600 })
}

/** Per-caller hourly cap on clip writes (cheap rows, but unbounded spam). */
export async function checkClipLimit(key: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.CLIP_RATE_LIMIT || '60')
  return checkLimit({ key: `rl:clip:${key}`, limit, windowSec: 3600 })
}

/** Per-caller per-minute cap on org writes. Cheap rows individually, but a
 *  runaway client or leaked token looping POST/PUT/PATCH/DELETE must not
 *  serialize the database. Reads never consume budget. */
export async function checkOrgWriteLimit(key: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.ORG_WRITE_RATE_LIMIT || '120')
  return checkLimit({ key: `rl:orgwrite:${key}`, limit, windowSec: 60 })
}

const ORG_WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Global write-method rate limit for the identity-bearing trees
 * (`/api/org/*`, `/api/email/*`, `/api/auth/user/*`). Composed FIRST in
 * app.ts: a global hook fires only for routes mounted after its .use()
 * (verified — same barrel class as the inert scoped wraps), and top-level
 * registration propagates into every nested mount. Keyed by verified
 * identity (fallback IP) so one abusive caller cannot spend the whole
 * org's budget. Reads pass through untouched; when the identity boundary
 * is off (local dev) the key degrades to IP.
 */
export const orgWriteRateLimit = new Elysia({ name: 'orgWriteRateLimit' }).onBeforeHandle(
  { as: 'global' },
  async ({ request, set }) => {
    if (!ORG_WRITE_METHODS.has(request.method)) return
    let pathname: string
    try {
      pathname = new URL(request.url).pathname
    } catch {
      return
    }
    if (
      !pathname.startsWith('/api/org/') &&
      !pathname.startsWith('/api/email/') &&
      !pathname.startsWith('/api/auth/user/')
    ) {
      return
    }
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    const { allowed, reset } = await checkOrgWriteLimit(verified ?? getIP(request))
    if (!allowed) {
      return rateLimited(
        set,
        'Too many changes. Wait a minute before trying again.',
        Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
      )
    }
  },
)

export function getIP(request: Request): string {
  const meta = readRequestMeta(request)
  return meta.clientIp ?? 'anonymous'
}

// ── Shared rejection (HTTP 429) ─────────────────────────────────────────────
// One mechanism for every rate-limit rejection: sets status 429 and builds the
// canonical envelope — a retryable RATE_LIMITED server error, plus an optional
// `retry_after` (seconds) when the limiter exposes a reset time.

export type RateLimitedBody = CoachAIError & { retry_after?: number }

export function rateLimited(
  set: { status?: number | string },
  message: string,
  retryAfterSeconds?: number,
): RateLimitedBody {
  set.status = 429
  const body: RateLimitedBody = { ...buildError('RATE_LIMITED', message, true) }
  if (retryAfterSeconds !== undefined) body.retry_after = retryAfterSeconds
  return body
}
