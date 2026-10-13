// ── Capability route kernel ──────────────────────────────────────────────────
// One home for the chain every browser-direct capability route repeats:
// rate-limit gate → job lookup + access check → engine error mapping. Routes
// keep their validation + engine calls; this owns the uniform HTTP mapping
// around them. Same adapter shape as withUserJob (C5 leverage): the kernel
// writes `set.status` and returns bodies the route returns verbatim.

import { buildError, isCoachAIError, type CoachAIError } from './errors'
import { getJob, type ServerJob } from './jobs'
import { resolveJobCaller, verifyJobAccess, type CallerOpts } from './jobAccess'
import { getIP } from './ratelimit'

export type CapabilitySet = {
  status?: number | string
  headers: Record<string, string | number | undefined>
}

export type RateLimitVerdict = {
  allowed: boolean
  remaining: number
  reset: number
}

/** Verified-sub-first rate-limit key: per-account buckets, IP fallback. */
export const capabilityLimitKey = (request: Request, opts?: CallerOpts): string =>
  resolveJobCaller(request, opts) ?? getIP(request)

export type RateLimitGate = { proceed: true } | { proceed: false; status: 429; body: unknown }

/**
 * Rate-limit gate. Always emits X-RateLimit-Remaining (scan parity); chat
 * never sent it, so routes that did not opt out the header keep prior wire
 * behavior via `emitRemaining: false`.
 */
export const gateRateLimit = async (
  _request: Request,
  set: CapabilitySet,
  opts: {
    check: () => Promise<RateLimitVerdict>
    deniedMessage: string
    emitRemaining?: boolean
  },
): Promise<RateLimitGate> => {
  const { allowed, remaining, reset } = await opts.check()
  if (opts.emitRemaining !== false) {
    set.headers['X-RateLimit-Remaining'] = String(remaining)
  }
  if (allowed) return { proceed: true }
  set.status = 429
  return {
    proceed: false,
    status: 429,
    body: {
      ...buildError('RATE_LIMITED', opts.deniedMessage, true),
      retry_after: Math.ceil((reset - Date.now()) / 1000),
    },
  }
}

export type JobRoute =
  | { ok: true; serverJob: ServerJob; callerSub: string | null }
  | { ok: false; status: number; body: unknown }

export type JobRouteDeps = {
  getJob?: typeof getJob
}

/** Job lookup + access check shared by download/chat/conversation routes. */
export const resolveJobRoute = async (
  serverJobId: string,
  request: Request,
  set: { status?: number | string },
  deps?: JobRouteDeps,
  opts?: CallerOpts,
): Promise<JobRoute> => {
  const serverJob = await (deps?.getJob ?? getJob)(serverJobId)
  if (!serverJob) {
    set.status = 404
    return {
      ok: false,
      status: 404,
      body: buildError('JOB_NOT_FOUND', 'Analysis session not found.', false),
    }
  }
  const access = verifyJobAccess(request, serverJob, null, opts)
  if (!access.ok) {
    set.status = access.status
    return { ok: false, status: access.status, body: access.body }
  }
  return { ok: true, serverJob, callerSub: access.callerSub }
}

/** Scan-style engine error map: structured errors pass through by code. */
export const capabilityErrorStatus = (code: string): number => {
  switch (code) {
    case 'NO_PLAYERS_DETECTED':
      return 422
    case 'VIDEO_DECODE_FAILED':
      return 422
    case 'ENGINE_UNAVAILABLE':
      return 503
    case 'MEDIAPIPE_UNAVAILABLE':
      return 503
    case 'INVALID_REQUEST':
      return 400
    default:
      return 500
  }
}

/**
 * Maps a caught engine-call failure to its HTTP body. Structured
 * CoachAIErrors pass through by code; anything else is logged under
 * `logType` and normalized to a safe 500 (never raw Bun/OS messages).
 */
export const mapEngineError = (
  set: { status?: number | string },
  error: unknown,
  opts: { logType: string; unknownMessage: string; unknownRetryable?: boolean },
): unknown => {
  if (isCoachAIError(error)) {
    set.status = capabilityErrorStatus(error.code)
    return error
  }
  const routeError = error as { code?: string; message?: string }
  console.error(
    JSON.stringify({
      type: opts.logType,
      code: String(routeError?.code ?? 'UNKNOWN'),
      message: String(routeError?.message ?? 'unknown'),
      timestamp: new Date().toISOString(),
    }),
  )
  set.status = 500
  return buildError('INTERNAL_ERROR', opts.unknownMessage, opts.unknownRetryable ?? true)
}

export type JsonBody =
  { ok: true; body: Record<string, unknown> } | { ok: false; body: CoachAIError }

/** Lenient JSON body parse: non-objects (incl. literal `null`) are 400s. */
export const readJsonBody = async (request: Request): Promise<JsonBody> => {
  try {
    const body = (await request.json()) as Record<string, unknown>
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('non-object JSON body')
    }
    return { ok: true, body }
  } catch {
    return {
      ok: false,
      body: buildError('INVALID_REQUEST', 'Invalid JSON request body.', false),
    }
  }
}
