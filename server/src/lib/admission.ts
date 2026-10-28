// ── Analysis admission (Card 3) ──────────────────────────────────────────────
// Single entry point for analysis admission: per-IP/per-account rate check,
// request validation, org quota + tier priority, then persist → enqueue →
// usage tail.
//
// Rate/queue/store are internal injectable seams grouped as { rate, queue,
// store }. Production uses the live adapters wired below; tests inject
// in-memory fakes. No other public ports: one job kind, one function.
//
// Caller derivation stays on resolveJobCaller (jobAccess); owner binding
// stays owner_ids [owner] (empty = anonymous bearer job). No audit writes
// here — auditRoute remains the only audit writer.

import { buildError } from './errors'
import { DEFAULT_MODEL, type CoachAIError } from '../types'
import { checkAnalysisLimit, getIP } from './ratelimit'
import { resolveJobCaller } from './jobAccess'
import { verifyAttributionToken } from './attribution'
import { readRequestMeta, type RequestMeta } from './requestMeta'
import { enqueueAnalysis, type AnalysisPayload } from './queue'
import { persistAnalysisStart } from './analyses'
import { checkOrgDailyQuota, getOrgTier, recordUsage, type OrgTier } from './analysisPolicy'
import { listMembershipsForUser } from './orgMembers'

// ── Entry, seams, outcome ───────────────────────────────────────────────────

export type AnalysisAdmission = {
  request: Request
  /** Pre-parsed + route-validated body. When present, JSON parsing is skipped. */
  body?: {
    session_token: string | null
    player_index: number | null
    video_key?: string | null
    angle?: string | null
  } | null
  /**
   * Signed-in roster scope (POST /api/me/analyze). Overrides the
   * attribution-derived org/priority/owners: quota + tier resolve on the
   * owning coach's org, priority bases at 10, owners bind coach + requester.
   */
  roster?: {
    coachAuth0Id: string
    requestedBy: string
    studentId: string | null
  } | null
}

export type AdmissionRate = {
  check(key: string): Promise<{ allowed: boolean; reset: number }>
}

export type AdmissionPersistRecord = RequestMeta & {
  serverJobId: string
  engineJobId: string
  sessionToken: string | null
  playerIndex: number | null
  model: string
  auth0Id?: string | null
  requestedBy?: string | null
  studentId?: string | null
}

export type AdmissionStore = {
  memberships(owner: string): Promise<Array<{ org_auth0_id: string }>>
  quota(orgAuth0Id: string): Promise<{ allowed: boolean; retryAfterSec: number }>
  tier(orgAuth0Id: string): Promise<OrgTier>
  persistStart(record: AdmissionPersistRecord): Promise<void>
  recordUsage(orgAuth0Id: string, kind: string): Promise<void>
}

export type AdmissionQueue = {
  enqueue(job: AnalysisPayload): Promise<void>
}

export type AdmissionSeams = {
  rate: AdmissionRate
  queue: AdmissionQueue
  store: AdmissionStore
}

export type AdmittedAnalysis = { ok: true; serverJobId: string }
export type RejectedAnalysis = {
  ok: false
  status: 400 | 429
  body: CoachAIError & { retry_after?: number }
}
export type AdmissionResult = AdmittedAnalysis | RejectedAnalysis

// Live adapters — module-private. Tests inject fakes via the seams param.
const liveSeams: AdmissionSeams = {
  rate: { check: checkAnalysisLimit },
  queue: { enqueue: enqueueAnalysis },
  store: {
    memberships: listMembershipsForUser,
    quota: checkOrgDailyQuota,
    tier: getOrgTier,
    persistStart: persistAnalysisStart,
    recordUsage,
  },
}

type AnalyzeBody = {
  session_token: string | null
  player_index: number | null
  video_key?: string | null
  angle?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

/**
 * Admit one analysis job: rate-limit → validate → org quota → tier priority
 * → persist → enqueue → usage tail. Returns a rejection (status + error
 * body) or the admitted server job id. Queue/store failures throw for the
 * route to map (QUEUE_UNAVAILABLE → 503, else 500).
 */
export async function admitAnalysis(
  entry: AnalysisAdmission,
  seams: AdmissionSeams = liveSeams,
): Promise<AdmissionResult> {
  const { request } = entry

  // ── Rate Limiting (per-IP, per-account when attributed) ────────────────
  const ip = getIP(request)
  const { allowed, reset } = await seams.rate.check(resolveJobCaller(request) ?? ip)
  if (!allowed) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000)
    return {
      ok: false,
      status: 429,
      body: {
        ...buildError(
          'RATE_LIMITED',
          'Analysis limit reached (5 per hour). Try again later.',
          true,
        ),
        retry_after: retryAfter,
      },
    }
  }

  // ── Validate Request ───────────────────────────────────────────────────
  const requestMeta = readRequestMeta(request)

  let body: AnalyzeBody
  const providedBody = entry.body ?? null
  if (providedBody) {
    body = {
      session_token: providedBody.session_token,
      player_index: providedBody.player_index,
      video_key: providedBody.video_key ?? null,
      angle: providedBody.angle ?? null,
    }
  } else {
    try {
      body = (await request.json()) as AnalyzeBody
    } catch {
      return {
        ok: false,
        status: 400,
        body: buildError('INVALID_REQUEST', 'Invalid JSON request body.', false),
      }
    }
  }

  const sessionToken = body.session_token
  const playerIndex = body.player_index
  const videoKey = body.video_key ?? null
  const angle = typeof body.angle === 'string' ? body.angle : null

  // Validate session_token format (must be UUID if provided)
  if (sessionToken !== null && (typeof sessionToken !== 'string' || !UUID_RE.test(sessionToken))) {
    return {
      ok: false,
      status: 400,
      body: buildError('INVALID_SESSION_TOKEN', 'Session token must be a valid UUID.', false),
    }
  }

  if (playerIndex !== null && (!Number.isInteger(playerIndex) || playerIndex < 1)) {
    return {
      ok: false,
      status: 400,
      body: buildError('INVALID_PLAYER_INDEX', undefined, false),
    }
  }

  // ── Admit, persist, enqueue ────────────────────────────────────────────
  const serverJobId = crypto.randomUUID()
  const engineJobId = crypto.randomUUID()
  const owner = verifyAttributionToken(request.headers.get('x-attribution'))

  // Per-org daily quota (§17): signed-in roster scope resolves on the owning
  // coach's org; otherwise the caller's primary org when attributed;
  // anonymous callers keep only the IP rate limit.
  const roster = entry.roster ?? null
  let priority = 0
  let orgAuth0Id: string | null = null
  let ownerIds: string[] = []
  let persistAuth0Id: string | null = owner
  let requestedBy: string | null = null
  let studentId: string | null = null
  const quotaDenied = (retryAfterSec: number) => ({
    ok: false as const,
    status: 429 as const,
    body: {
      ...buildError(
        'RATE_LIMITED',
        'Organization daily analysis limit reached. Try again tomorrow.',
        true,
      ),
      retry_after: retryAfterSec,
    },
  })
  if (roster) {
    orgAuth0Id = roster.coachAuth0Id
    const quota = await seams.store.quota(orgAuth0Id)
    if (!quota.allowed) {
      return quotaDenied(quota.retryAfterSec)
    }
    // Fair queueing (§17): signed-in roster jobs outrank anonymous ones,
    // paid tiers outrank free. FIFO within a priority (no starvation).
    const tier = await seams.store.tier(orgAuth0Id).catch(() => 'free' as const)
    priority = 10 + (tier === 'elite' ? 10 : tier === 'pro' ? 5 : 0)
    ownerIds = [roster.coachAuth0Id, roster.requestedBy].filter(
      (id, i, arr) => id && arr.indexOf(id) === i,
    )
    persistAuth0Id = roster.coachAuth0Id
    requestedBy = roster.requestedBy
    studentId = roster.studentId
  } else if (owner) {
    const memberships = await seams.store.memberships(owner).catch(() => [])
    orgAuth0Id = memberships[0]?.org_auth0_id ?? owner
    const quota = await seams.store.quota(orgAuth0Id)
    if (!quota.allowed) {
      return quotaDenied(quota.retryAfterSec)
    }
    // Fair queueing (§17): authenticated jobs outrank anonymous ones,
    // paid tiers outrank free. FIFO within a priority (no starvation).
    const tier = await seams.store.tier(orgAuth0Id).catch(() => 'free' as const)
    priority = 5 + (tier === 'elite' ? 10 : tier === 'pro' ? 5 : 0)
    ownerIds = [owner]
  }

  // History row first so a queued job always has a persisted record; the
  // usage ledger trails only fully admitted jobs (best-effort, never fatal).
  await seams.store.persistStart({
    ...requestMeta,
    serverJobId,
    engineJobId,
    sessionToken,
    playerIndex,
    model: DEFAULT_MODEL,
    auth0Id: persistAuth0Id,
    requestedBy,
    studentId,
  })

  await seams.queue.enqueue({
    server_job_id: serverJobId,
    engine_job_id: engineJobId,
    session_token: sessionToken,
    player_index: playerIndex,
    video_key: videoKey,
    angle,
    priority,
    owner_ids: ownerIds,
  })

  if (orgAuth0Id) {
    await seams.store.recordUsage(orgAuth0Id, 'analysis').catch(() => {})
  }

  return { ok: true, serverJobId }
}
