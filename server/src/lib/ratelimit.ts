import { redis } from "./redis"

// Rate limiting with local Redis fallback
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
    const now = Date.now()
    const windowMs = 60 * 1000 // 1 minute
    const limit = 10

    const raw = await redis.get(key)
    if (!raw || now > (raw as any).resetAt) {
      await redis.set(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), { ex: 60 })
      return { allowed: true, remaining: limit - 1, reset: now + windowMs }
    }

    const data = typeof raw === "string" ? JSON.parse(raw) : raw
    data.count++
    await redis.set(key, JSON.stringify(data), { ex: 60 })

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
    const now = Date.now()
    const windowMs = 60 * 60 * 1000 // 1 hour
    const limit = 5

    const raw = await redis.get(key)
    if (!raw || now > (raw as any).resetAt) {
      await redis.set(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), { ex: 3600 })
      return { allowed: true, remaining: limit - 1, reset: now + windowMs }
    }

    const data = typeof raw === "string" ? JSON.parse(raw) : raw
    data.count++
    await redis.set(key, JSON.stringify(data), { ex: 3600 })

    if (data.count > limit) {
      return { allowed: false, remaining: 0, reset: data.resetAt }
    }
    return { allowed: true, remaining: limit - data.count, reset: data.resetAt }
  } catch {
    // Redis down: fail open
    return memoryLimit(`analysis:${ip}`, 5, 3600_000)
  }
}

export function getIP(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  )
}
