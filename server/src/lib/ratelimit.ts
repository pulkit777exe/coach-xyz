import { redis } from "./redis"

// Rate limiting with atomic Redis increments
// When Redis is unavailable, fail open — don't block users

interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset: number
}

// Simple in-memory rate limit fallback
const memoryLimits = new Map<string, { count: number; resetAt: number }>()

function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
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

export async function checkScanLimit(ip: string): Promise<RateLimitResult> {
  try {
    const key = `rl:scan:${ip}`
    const limit = 10
    const windowSec = 60

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
    const now = Date.now()
    const raw = await redis.get(key)
    if (!raw || now > (raw as any).resetAt) {
      await redis.set(key, JSON.stringify({ count: 1, resetAt: now + windowSec * 1000 }), { ex: windowSec })
      return { allowed: true, remaining: limit - 1, reset: now + windowSec * 1000 }
    }

    const data = typeof raw === "string" ? JSON.parse(raw) : raw
    data.count++
    await redis.set(key, JSON.stringify(data), { ex: windowSec })

    if (data.count > limit) {
      return { allowed: false, remaining: 0, reset: data.resetAt }
    }
    return { allowed: true, remaining: limit - data.count, reset: data.resetAt }
  } catch {
    // Redis down: fail open
    return memoryLimit(`scan:${ip}`, 10, 60_000)
  }
}

export async function checkAnalysisLimit(ip: string): Promise<RateLimitResult> {
  try {
    const key = `rl:analysis:${ip}`
    const limit = 5
    const windowSec = 3600

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
    const now = Date.now()
    const raw = await redis.get(key)
    if (!raw || now > (raw as any).resetAt) {
      await redis.set(key, JSON.stringify({ count: 1, resetAt: now + windowSec * 1000 }), { ex: windowSec })
      return { allowed: true, remaining: limit - 1, reset: now + windowSec * 1000 }
    }

    const data = typeof raw === "string" ? JSON.parse(raw) : raw
    data.count++
    await redis.set(key, JSON.stringify(data), { ex: windowSec })

    if (data.count > limit) {
      return { allowed: false, remaining: 0, reset: data.resetAt }
    }
    return { allowed: true, remaining: limit - data.count, reset: data.resetAt }
  } catch {
    // Redis down: fail open
    return memoryLimit(`analysis:${ip}`, 5, 3600_000)
  }
}

export async function checkBetaCodeLimit(betaCode: string): Promise<RateLimitResult> {
  // Per-beta-code rate limit: 20 analyses per hour per code
  // Prevents IP-hopping when a code is shared/leaked
  try {
    const key = `rl:beta:${betaCode}`
    const limit = 20
    const windowSec = 3600

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
    const now = Date.now()
    const raw = await redis.get(key)
    if (!raw || now > (raw as any).resetAt) {
      await redis.set(key, JSON.stringify({ count: 1, resetAt: now + windowSec * 1000 }), { ex: windowSec })
      return { allowed: true, remaining: limit - 1, reset: now + windowSec * 1000 }
    }

    const data = typeof raw === "string" ? JSON.parse(raw) : raw
    data.count++
    await redis.set(key, JSON.stringify(data), { ex: windowSec })

    if (data.count > limit) {
      return { allowed: false, remaining: 0, reset: data.resetAt }
    }
    return { allowed: true, remaining: limit - data.count, reset: data.resetAt }
  } catch {
    // Redis down: fail open
    return memoryLimit(`beta:${betaCode}`, 20, 3600_000)
  }
}

export function getIP(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  )
}

export function getBetaCode(request: Request): string | null {
  return request.headers.get("x-beta-code")?.trim().toLowerCase() ?? null
}
