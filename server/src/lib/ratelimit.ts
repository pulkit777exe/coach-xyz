import { redis } from './redis'
import { readRequestMeta } from './requestMeta'

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

/** Test seam: substitute the Redis client (e.g. a throwing stub for the no-Redis path). */
let redisOverride: Pick<typeof redis, 'rateLimitIncrement'> | null = null
export const __setRedisForTests = (
  client: Pick<typeof redis, 'rateLimitIncrement'> | null,
): void => {
  redisOverride = client
}

export async function checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  const { key, limit, windowSec } = config
  try {
    // Atomic increment fails over to the in-memory limiter below when Redis is down
    const client = redisOverride ?? redis
    const result = await client.rateLimitIncrement(key, limit, windowSec)
    return {
      allowed: result.allowed,
      remaining: Math.max(0, limit - result.current),
      reset: result.reset,
    }
  } catch {
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

/** Per-session per-minute cap on scan-progress SSE opens. Keyed on the
 *  unguessable session token (not the IP): one session's progress stream
 *  cannot be used to amplify, and header-rotated clients gain nothing. */
export async function checkScanProgressLimit(sessionToken: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.SCAN_PROGRESS_RATE_LIMIT || '30')
  return checkLimit({ key: `rl:scanprogress:${sessionToken}`, limit, windowSec: 60 })
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

export function getIP(request: Request): string {
  const meta = readRequestMeta(request)
  return meta.clientIp ?? 'anonymous'
}
