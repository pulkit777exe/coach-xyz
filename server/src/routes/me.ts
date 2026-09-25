import { Elysia } from 'elysia'

import { buildError, type CoachAIError } from '../lib/errors'
import { getUserByAuth0Id, updateUserProfile, resolveAuth0Id } from '../lib/users'
import { persistAnalysisStart } from '../lib/analyses'
import {
  getLinkedPlayer,
  listAttendance,
  attendanceSummary,
  listSchedule,
  getStudentPerformanceSeries,
  getStudentAnalyses,
  listReports,
  getReport,
  listObjectives,
} from '../lib/orgData'
import { serviceGuard } from '../lib/serviceGuard'
import { missingVerifiedSelf, requireVerifiedSelf } from '../lib/caller'
import { admitAnalysis } from '../lib/analysisAdmission'
import { redactWellness } from '../lib/permissions'
import { logger } from '../lib/logger'
import { listMembershipsForUser } from '../lib/orgMembers'
import { readRequestMeta } from '../lib/requestMeta'
import { mintAttributionToken } from '../lib/attribution'
import { acceptInvite } from '../lib/invites'
import { auditRoute } from '../lib/audit'
import { enqueueAnalysis } from '../lib/queue'
import { UUID_RE } from '../lib/uuid'
import {
  notificationPrefs,
  upsertNotificationPrefs,
  validateNotificationPrefsPatch,
} from '../lib/notificationPrefs'
import { DEFAULT_MODEL } from '../types'

/**
 * Resolves the verified caller (from the proxy-injected header) to their linked
 * player view: the owning coach's auth0Id plus the student row. Returns null
 * when the account is not linked to any student yet.
 */
const playerScope = async (verifiedAuth0Id: string) => {
  const primary = (await resolveAuth0Id(verifiedAuth0Id)) ?? verifiedAuth0Id
  const linked = await getLinkedPlayer(primary)
  return {
    accountAuth0Id: primary,
    student: linked?.student ?? null,
    coachAuth0Id: linked?.coachAuth0Id ?? null,
  }
}

export type PlayerScopeResult = {
  accountAuth0Id: string
  student: { id: string } | null
  coachAuth0Id: string | null
}

/**
 * Pure "me-analyze" scoping decision. Turns the verified player identity +
 * their resolved player scope into the coach-scoped persistence target (the
 * job shows up in the coach's history) plus the attribution (requested_by).
 * Returns an error descriptor when the account is not linked/verified.
 */
export type PlayerAnalysisDecision =
  | { ok: true; coachAuth0Id: string; requestedBy: string; studentId: string }
  | { ok: false; status: 403; error: CoachAIError }

export const decidePlayerAnalysis = (input: {
  verifiedAuth0Id: string | null
  playerScope: PlayerScopeResult
}): PlayerAnalysisDecision => {
  const { verifiedAuth0Id, playerScope: scope } = input
  if (!verifiedAuth0Id) return missingVerifiedSelf()
  if (!scope.student || !scope.coachAuth0Id) {
    return {
      ok: false,
      status: 403,
      error: buildError('FORBIDDEN', 'No linked player account', false),
    }
  }
  return {
    ok: true,
    coachAuth0Id: scope.coachAuth0Id,
    requestedBy: verifiedAuth0Id,
    studentId: scope.student.id,
  }
}

export default new Elysia()
  .use(serviceGuard)

  // Org context: which orgs does the verified caller belong to (as owner or
  // member)? The web app uses the primary one to scope every /api/org|email and
  // /api/auth/user call, so invited coaches see the org they belong to instead
  // of an empty org keyed by their own sub.
  .get('/api/me/orgs', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    // Linked accounts: the caller may sign in via a secondary provider, but
    // memberships are keyed by the primary auth0_id.
    const primary = (await resolveAuth0Id(verified)) ?? verified
    const orgs = await listMembershipsForUser(primary)
    set.status = 200
    return { orgs }
  })

  // Own profile: user record + linked student (if any)
  .get('/api/me/profile', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const { accountAuth0Id, student, coachAuth0Id } = await playerScope(verified)
    const user = await getUserByAuth0Id(accountAuth0Id)

    set.status = 200
    return { user, student, coach_auth0_id: coachAuth0Id }
  })

  // Update own profile (name, nickname, picture)
  .put('/api/me/profile', async ({ body, request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const { name, nickname, picture } = body as Record<string, unknown>
    if (
      (name !== undefined && name !== null && typeof name !== 'string') ||
      (nickname !== undefined && nickname !== null && typeof nickname !== 'string') ||
      (picture !== undefined && picture !== null && typeof picture !== 'string')
    ) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        'name, nickname and picture must be strings or null',
        false,
      )
    }
    if (typeof name === 'string' && name.length > 200) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'name is too long', false)
    }
    if (typeof picture === 'string' && picture.length > 2000) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'picture URL is too long', false)
    }

    const user = await updateUserProfile(verified, {
      name: name === undefined ? undefined : (name as string | null),
      nickname: nickname === undefined ? undefined : (nickname as string | null),
      picture: picture === undefined ? undefined : (picture as string | null),
    })
    if (!user) {
      set.status = 404
      return buildError('NOT_FOUND', 'User record not found', false)
    }
    auditRoute(request, verified, 'settings.changed', 'user_profile', verified)
    set.status = 200
    return { user }
  })

  // Own in-app notification preferences. No row means enabled defaults.
  .get('/api/me/notification-preferences', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const preferences = await notificationPrefs(verified)
    set.status = 200
    return preferences
  })
  .put('/api/me/notification-preferences', async ({ request, body, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const validated = validateNotificationPrefsPatch(body)
    if (!validated.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', validated.message, false)
    }

    const preferences = await upsertNotificationPrefs(verified, validated.value)
    if (!preferences) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to update notification preferences', true)
    }

    auditRoute(request, verified, 'settings.changed', 'notification_preferences', verified)
    set.status = 200
    return preferences
  })

  // Own attendance history + summary (joined with the linked player scope)
  .get('/api/me/attendance', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { records: [], summary: null, linked: false }
    }

    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? undefined

    const [records, summary] = await Promise.all([
      listAttendance(coachAuth0Id, { from, to, studentId: student.id }),
      attendanceSummary(coachAuth0Id, { from, to, studentId: student.id }),
    ])

    set.status = 200
    return { records, summary, linked: true }
  })

  // Team schedule (all events for the owning coach's org)
  .get('/api/me/schedule', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { coachAuth0Id } = await playerScope(verified)
    if (!coachAuth0Id) {
      set.status = 200
      return { events: [], linked: false }
    }

    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? undefined

    const events = await listSchedule(coachAuth0Id, { from, to })
    set.status = 200
    return { events, linked: true }
  })

  // Own performance trends (analysis form scores + any manual metrics)
  .get('/api/me/performance', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { points: [], linked: false }
    }

    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? undefined

    const points = await getStudentPerformanceSeries(coachAuth0Id, student.id, {
      from,
      to,
    })
    set.status = 200
    return { points, linked: true }
  })

  // Own training objectives (read-only player view of the coaching loop)
  .get('/api/me/objectives', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { objectives: [], linked: false }
    }
    const objectives = await listObjectives(coachAuth0Id, { studentId: student.id })
    set.status = 200
    return { objectives, linked: true }
  })

  // Own analyses (analysis_history rows linked to the player's student row)
  .get('/api/me/analyses', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { analyses: [], linked: false }
    }

    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100)

    const analyses = await getStudentAnalyses(coachAuth0Id, student.id, limit)
    // Player scope never carries wellness signals (§5) — strip injury_risk.
    set.status = 200
    return {
      analyses: analyses.map((a) => ({
        ...a,
        summary_json: redactWellness(a.summary_json),
      })),
      linked: true,
    }
  })

  // Reports that mention me (student-scoped)
  .get('/api/me/reports', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { reports: [], linked: false }
    }

    const reports = await listReports(coachAuth0Id, { studentId: student.id })
    set.status = 200
    return { reports, linked: true }
  })

  .get('/api/me/reports/:id', async ({ request, params, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { report: null, linked: false }
    }

    const report = await getReport(coachAuth0Id, params.id)
    if (!report || report.student_id !== student.id) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found', false)
    }

    set.status = 200
    return { report, linked: true }
  })

  // Self-scoped analysis kickoff: the player uploads/scans a video through the
  // capability endpoints (scan.ts), then starts the analysis here. The job is
  // persisted under the LINKED coach's auth0Id (so it appears in the coach's
  // dashboard history) with requested_by = the player, and is linked to the
  // player's student row so it shows up in /api/me/analyses.
  .post('/api/me/analyze', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid JSON request body.', false)
    }

    const sessionTokenRaw = body.session_token ?? null
    const playerIndexRaw = body.player_index ?? null
    const videoKeyRaw = body.video_key ?? null
    const angleRaw = body.angle ?? null
    if (sessionTokenRaw !== null && typeof sessionTokenRaw !== 'string') {
      set.status = 400
      return buildError('INVALID_SESSION_TOKEN', 'Session token must be a valid UUID.', false)
    }
    if (sessionTokenRaw !== null && !UUID_RE.test(sessionTokenRaw)) {
      set.status = 400
      return buildError('INVALID_SESSION_TOKEN', 'Session token must be a valid UUID.', false)
    }
    if (
      playerIndexRaw !== null &&
      (typeof playerIndexRaw !== 'number' ||
        !Number.isInteger(playerIndexRaw) ||
        playerIndexRaw < 1)
    ) {
      set.status = 400
      return buildError('INVALID_PLAYER_INDEX', undefined, false)
    }
    if (videoKeyRaw !== null && typeof videoKeyRaw !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'video_key must be null or a string.', false)
    }
    if (angleRaw !== null && typeof angleRaw !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'angle must be null or a string.', false)
    }

    const sessionToken = typeof sessionTokenRaw === 'string' ? sessionTokenRaw : null
    const playerIndex = typeof playerIndexRaw === 'number' ? playerIndexRaw : null
    const videoKey = typeof videoKeyRaw === 'string' ? videoKeyRaw : null
    const angle = typeof angleRaw === 'string' ? angleRaw : null

    const scope = await playerScope(verified)
    const decision = decidePlayerAnalysis({
      verifiedAuth0Id: verified,
      playerScope: scope,
    })
    if (!decision.ok) {
      set.status = decision.status
      return decision.error
    }

    // Per-org daily quota (§17) on the owning coach's org. Player-hub jobs are
    // authenticated humans waiting on UX — base priority 10 outranks
    // /api/analyze's base 5 (tier-weighted inside admitAnalysis).
    const admission = await admitAnalysis({
      orgAuth0Id: decision.coachAuth0Id,
      basePriority: 10,
      set,
    })
    if (!admission.ok) return admission.error
    const priority = admission.priority

    const server_job_id = crypto.randomUUID()
    const engine_job_id = crypto.randomUUID()

    try {
      // Save the server job mapping to Redis BEFORE enqueuing
      await enqueueAnalysis({
        server_job_id,
        engine_job_id,
        session_token: sessionToken,
        player_index: playerIndex,
        video_key: videoKey,
        angle,
        // Player-hub jobs are authenticated humans waiting on UX —
        // outrank anonymous queue entries (tier-weighted above).
        priority,
        owner_ids: [decision.coachAuth0Id, decision.requestedBy].filter(
          (id, i, arr) => id && arr.indexOf(id) === i,
        ),
      })

      await persistAnalysisStart({
        ...readRequestMeta(request),
        serverJobId: server_job_id,
        engineJobId: engine_job_id,
        sessionToken,
        playerIndex,
        model: DEFAULT_MODEL,
        auth0Id: decision.coachAuth0Id,
        requestedBy: decision.requestedBy,
        studentId: decision.studentId,
      })

      set.status = 200
      return { job_id: server_job_id }
    } catch (error) {
      if (error instanceof Error && error.message === 'QUEUE_UNAVAILABLE') {
        set.status = 503
        return buildError('QUEUE_UNAVAILABLE', 'Job queue is not configured.', true)
      }
      logger.error('me_analyze_enqueue_error', {
        type: 'me_analyze_enqueue_error',
        error: (error as Error)?.message,
      })
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to enqueue analysis job. Please try again.', true)
    }
  })

  // Accept an organization invitation: the verified caller redeems a
  // single-use token minted for their email. Links their account on success.
  .post('/api/me/invites/accept', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    let parsed: Record<string, unknown>
    try {
      parsed = (await request.json()) as Record<string, unknown>
    } catch {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid JSON request body.', false)
    }
    const token = parsed.token
    if (typeof token !== 'string' || !token) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'token is required.', false)
    }
    const result = await acceptInvite(token, verified)
    if (!result.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', result.error, false)
    }
    auditRoute(
      request,
      result.orgAuth0Id,
      'member.invite_accepted',
      'org_invite',
      null,
      {
        role: result.role,
      },
      verified,
    )
    set.status = 200
    return { org_auth0_id: result.orgAuth0Id, role: result.role }
  })

  // Mint a short-lived attribution token binding the verified session sub.
  // Browser-direct capability routes (scan/analyze) receive it as `x-attribution`
  // and the server resolves the caller from the signed sub — never from a raw
  // client header. Requires the identity boundary (x-verified-auth0-id), so an
  // attacker cannot mint tokens for a sub they are not signed in as.
  .get('/api/me/attribution/mint', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const minted = mintAttributionToken(verified)
    if (!minted) {
      set.status = 503
      return buildError('SERVICE_NOT_CONFIGURED', 'Attribution signing is not configured.', true)
    }
    set.status = 200
    return minted
  })
