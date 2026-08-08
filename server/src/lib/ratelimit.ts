import { redis } from "./redis"
import { readRequestMeta } from "./requestMeta"
import { serviceUpdate } from "./serviceRegistry"

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
    const entries = [...memoryLimits.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt)
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
  return { allowed: true, remaining: limit - entry.count, reset: entry.resetAt }
}

interface RateLimitConfig {
  key: string
  limit: number
  windowSec: number
}

export async function checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  const { key, limit, windowSec } = config
  try {
    // Try atomic increment first
    if (redis.rateLimitIncrement) {
      const result = await redis.rateLimitIncrement(key, limit, windowSec)
      return {
        allowed: result.allowed,
        remaining: Math.max(0, limit - result.current),
        reset: result.reset,
      }
    }

    // Fallback to non-atomic (Upstash REST)
    // Use INCR + EXPIRE for atomicity instead of GET/SET
    const count = await redis.incr(key)
    if (count === 1) {
      // First request in this window — set expiry
      await redis.expire(key, windowSec)
    }
    const reset = Date.now() + windowSec * 1000

    if (count > limit) {
      return { allowed: false, remaining: 0, reset }
    }
    return { allowed: true, remaining: limit - count, reset }
  } catch {
    serviceUpdate("redis", "degraded", "Rate limiter using in-memory fallback")
    return memoryLimit(key, limit, windowSec * 1000)
  }
}

export async function checkScanLimit(ip: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.SCAN_RATE_LIMIT || "100")
  return checkLimit({ key: `rl:scan:${ip}`, limit, windowSec: 60 })
}

export async function checkAnalysisLimit(ip: string): Promise<RateLimitResult> {
  const limit = parseInt(process.env.ANALYSIS_RATE_LIMIT || "50")
  return checkLimit({ key: `rl:analysis:${ip}`, limit, windowSec: 3600 })
}

export function getIP(request: Request): string {
  const meta = readRequestMeta(request)
  return meta.clientIp ?? "anonymous"
}
