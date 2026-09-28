import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { readRequestMeta } from '../lib/requestMeta'
import { enqueueAnalysis } from '../lib/queue'
import { checkAnalysisLimit, getIP, rateLimited } from '../lib/ratelimit'
import { resolveJobCaller } from '../lib/jobAccess'
import { verifyAttributionToken } from '../lib/attribution'
import { UUID_RE } from '../lib/uuid'
import { persistAnalysisStart } from '../lib/analyses'
import { admitAnalysis } from '../lib/analysisAdmission'
import { listMembershipsForUser } from '../lib/orgMembers'
import { resolveAuth0Id } from '../lib/users'
import { hasPermission } from '../lib/permissions'
import { DEFAULT_MODEL } from '../types'
import { logger } from '../lib/logger'

type AnalyzeBody = {
  session_token: string | null
  player_index: number | null
  video_key?: string | null
  angle?: string | null
  org_auth0_id?: string | null
}

export default new Elysia().post('/api/analyze-video', async ({ request, set }) => {
  // ── Rate Limiting (per-IP, per-account when attributed) ────────────────
  const ip = getIP(request)
  const { allowed, reset } = await checkAnalysisLimit(resolveJobCaller(request) ?? ip)
  if (!allowed) {
    return rateLimited(
      set,
      'Analysis limit reached (5 per hour). Try again later.',
      Math.ceil((reset - Date.now()) / 1000),
    )
  }

  // ── Validate Request ───────────────────────────────────────────────────
  let body: AnalyzeBody
  const requestMeta = readRequestMeta(request)

  try {
    body = (await request.json()) as AnalyzeBody
  } catch {
    set.status = 400
    return buildError('INVALID_REQUEST', 'Invalid JSON request body.', false)
  }

  const sessionToken = body.session_token
  const playerIndex = body.player_index
  const videoKey = body.video_key ?? null
  const angle = typeof body.angle === 'string' ? body.angle : null
  // The club to charge and own the analysis. Attributed members name it
  // explicitly (the web sends its active org); absent keeps today's behavior.
  const requestedOrg =
    typeof body.org_auth0_id === 'string' && body.org_auth0_id ? body.org_auth0_id : null

  // Validate session_token format (must be UUID if provided)
  if (sessionToken !== null && (typeof sessionToken !== 'string' || !UUID_RE.test(sessionToken))) {
    set.status = 400
    return buildError('INVALID_SESSION_TOKEN', 'Session token must be a valid UUID.', false)
  }

  if (playerIndex !== null && (!Number.isInteger(playerIndex) || playerIndex < 1)) {
    set.status = 400
    return buildError('INVALID_PLAYER_INDEX', undefined, false)
  }

  // ── Create Job and Enqueue ─────────────────────────────────────────────
  try {
    const server_job_id = crypto.randomUUID()
    const engine_job_id = crypto.randomUUID()
    const owner = verifyAttributionToken(request.headers.get('x-attribution'))

    // Per-org daily quota (§17): resolve the caller's primary org when
    // attributed; anonymous callers keep only the IP rate limit.
    let priority = 0
    // The org key the analysis row is stored under, and who requested it.
    let orgAuth0Id: string | null = null
    let requestedBy: string | null = null
    if (owner) {
      let memberships: Awaited<ReturnType<typeof listMembershipsForUser>>
      try {
        memberships = await listMembershipsForUser(owner)
      } catch (error) {
        // Fail-open to owner-as-org (the ADR no-DB policy) — but the miss
        // also drops the org daily quota, so log it.
        logger.warn('analyze_org_lookup_failed', {
          type: 'analyze_org_lookup_failed',
          error: error instanceof Error ? error.message : String(error),
        })
        memberships = []
      }
      if (requestedOrg) {
        // An invited coach analyzes for the club: the row is keyed by the
        // club, the coach is recorded as the requester, and quota/priority
        // are charged to the club. Linked accounts resolve to the primary id
        // first so the membership check cannot be dodged with a secondary sub.
        const primary = await resolveAuth0Id(owner)
        const membership = memberships.find((m) => m.org_auth0_id === requestedOrg)
        if (!membership || !hasPermission(membership.role, 'analysis.create')) {
          set.status = 403
          return buildError(
            'FORBIDDEN',
            'You are not a member of this organization',
            false,
          )
        }
        orgAuth0Id = requestedOrg
        requestedBy = primary
      } else {
        orgAuth0Id = memberships?.[0]?.org_auth0_id ?? owner
        // A member of someone else's club analyzing without naming it lands
        // quota and ownership on the wrong org (usually their own empty one).
        // The web always sends org_auth0_id, so this is a caller that needs
        // updating, not a case to silently accept.
        if (memberships.some((m) => m.org_auth0_id !== owner)) {
          logger.warn('analyze_org_unspecified', {
            type: 'analyze_org_unspecified',
            owner,
            orgs: memberships.map((m) => m.org_auth0_id),
          })
        }
      }
      // Quota + fair-queue admission (§17): base 5 for attributed jobs, paid
      // tiers outrank free (tier-weighted inside admitAnalysis).
      const admission = await admitAnalysis({ orgAuth0Id, basePriority: 5, set })
      if (!admission.ok) return admission.error
      priority = admission.priority
    }

    // Save the server job mapping to Redis BEFORE enqueuing
    await enqueueAnalysis({
      server_job_id,
      engine_job_id,
      session_token: sessionToken,
      player_index: playerIndex,
      video_key: videoKey,
      angle,
      priority,
      // The org owner reads status, chat and download through these ids.
      owner_ids: [...new Set([orgAuth0Id, owner].filter(Boolean))] as string[],
    })

    await persistAnalysisStart({
      ...requestMeta,
      serverJobId: server_job_id,
      engineJobId: engine_job_id,
      sessionToken,
      playerIndex,
      model: DEFAULT_MODEL,
      auth0Id: orgAuth0Id ?? owner,
      requestedBy,
    })

    set.status = 200
    return { job_id: server_job_id }
  } catch (error) {
    if (error instanceof Error && error.message === 'QUEUE_UNAVAILABLE') {
      set.status = 503
      return buildError('QUEUE_UNAVAILABLE', 'Job queue is not configured.', true)
    }
    logger.error('analyze_enqueue_error', {
      type: 'analyze_enqueue_error',
      error: (error as Error)?.message,
      stack: (error as Error)?.stack,
    })
    set.status = 500
    return buildError('INTERNAL_ERROR', 'Failed to enqueue analysis job. Please try again.', true)
  }
})
