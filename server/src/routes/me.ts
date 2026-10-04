import { Elysia } from 'elysia'

import { buildError, type CoachAIError } from '../lib/errors'
import { readListLimit, scheduleWindow } from '../lib/orgValidate'
import { getUserByAuth0Id, updateUserProfile, resolveAuth0Id } from '../lib/users'
import { historyStoreEnabled } from '../lib/historyStore'
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
import { attendanceWindow } from './org/attendance'
import { serviceGuard } from '../lib/serviceGuard'
import { missingVerifiedSelf, requireVerifiedSelf, type MissingVerifiedSelf } from '../lib/caller'
import { admitAnalysis } from '../lib/analysisAdmission'
import { redactWellness } from '../lib/permissions'
import { pickInt, pickUuid } from '../lib/uuid'
import { logger } from '../lib/logger'
import { listMembershipsForUser } from '../lib/orgMembers'
import { readRequestMeta } from '../lib/requestMeta'
import { mintAttributionToken } from '../lib/attribution'
import { acceptInvite } from '../lib/invites'
import { findActiveMemberRowId, offboardMember } from '../lib/orgOffboard'
import { notifyMembershipChanged } from '../lib/notificationEvents'
import { auditRoute } from '../lib/audit'
import { enqueueAnalysis } from '../lib/queue'
import { UUID_RE } from '../lib/uuid'
import {
  notificationPrefs,
  upsertNotificationPrefs,
  validateNotificationPrefsPatch,
} from '../lib/notificationPrefs'
import { userSettings, upsertUserSettings, validateUserSettingsPatch } from '../lib/userSettings'
import {
  consentForStudent,
  unlinkedConsent,
  upsertConsent,
  validateConsentPatch,
} from '../lib/consents'
import { buildAccountExport, exportFilename } from '../lib/dataExport'
import {
  createPrivacyRequest,
  listPrivacyRequests,
  validatePrivacyRequestBody,
} from '../lib/privacyRequests'
import { DEFAULT_MODEL } from '../types'

/**
 * Resolves the verified caller (from the proxy-injected header) to their linked
 * player view: the owning coach's auth0Id plus the student row. Returns null
 * when the account is not linked to any student yet.
 */
const playerScope = async (verifiedAuth0Id: string) => {
  // Disabled store is an empty world, not an outage: answer unlinked so
  // settings screens render. Unreachable-but-configured still throws loud
  // below — failing open there would silently unlist linked players.
  // Writes stay fail-closed via missingLinkedPlayer either way.
  if (!historyStoreEnabled()) {
    return { accountAuth0Id: verifiedAuth0Id, student: null, coachAuth0Id: null }
  }
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
  // `team_id` is optional because not every caller needs it, and several test
  // fixtures build this shape. It is here because `/api/me/schedule` narrows by
  // it, and that narrowing is not decoration: the route used to read the whole
  // org's calendar, so a player on team A saw team B's fixtures, and the same
  // person got a DIFFERENT answer from `/api/org/:auth0Id/schedule`, which has
  // always narrowed through `caller.studentScope`. Two routes, one person, two
  // answers. Absent means "no team known", which reads as the unassigned case.
  student: { id: string; team_id?: string | null } | null
  coachAuth0Id: string | null
}

/**
 * The canonical "this account is not linked to a player" rejection (403,
 * non-retryable FORBIDDEN). Single owner of the literal, shared by the
 * analysis-admission decision and the consent write — the two self-scoped
 * writes that have nothing to write without a player row.
 */
export function missingLinkedPlayer(): MissingVerifiedSelf {
  return {
    ok: false,
    status: 403,
    error: buildError('FORBIDDEN', 'No linked player account', false),
  }
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
  if (!scope.student || !scope.coachAuth0Id) return missingLinkedPlayer()
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

    const { name, nickname, picture } = (body ?? {}) as Record<string, unknown>
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

  // Own display preferences (theme, reduce motion, week start). Self-scoped for
  // every role, so a player's device syncs the same settings as a coach's.
  .get('/api/me/preferences', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const settings = await userSettings(verified)
    set.status = 200
    return settings
  })
  .put('/api/me/preferences', async ({ request, body, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const validated = validateUserSettingsPatch(body)
    if (!validated.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', validated.message, false)
    }

    const settings = await upsertUserSettings(verified, validated.value)
    if (!settings) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to update preferences', true)
    }

    auditRoute(request, verified, 'settings.changed', 'user_settings', verified)
    set.status = 200
    return settings
  })

  // ── Consent & data rights ──────────────────────────────────────────────────
  // Consent is per player (keyed by the linked student row), so the read
  // answers for an unlinked account instead of erroring: the settings screen
  // has to render for a coach-only account too.
  .get('/api/me/consent', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const { student } = await playerScope(verified)
    set.status = 200
    return student ? consentForStudent(student.id) : unlinkedConsent()
  })
  .put('/api/me/consent', async ({ request, body, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const validated = validateConsentPatch(body)
    if (!validated.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', validated.message, false)
    }

    const { student } = await playerScope(verified)
    if (!student) {
      const rejection = missingLinkedPlayer()
      set.status = rejection.status
      return rejection.error
    }

    const consent = await upsertConsent(student.id, validated.value)
    if (!consent) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to save consent', true)
    }

    auditRoute(request, verified, 'settings.changed', 'player_consent', student.id, {
      policy_version: consent.policyVersion,
      training_data: consent.trainingData,
      medical_data: consent.medicalData,
      marketing: consent.marketing,
    })
    set.status = 200
    return consent
  })

  // Portability: every record the account holds, as one JSON attachment. The
  // bundle is built from the VERIFIED sub alone (lib/dataExport resolves the
  // player link itself), so it cannot be aimed at another account.
  .get('/api/me/export', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    // Linked accounts may sign in via a secondary provider; the data is keyed
    // to the primary auth0_id.
    const accountAuth0Id = (await resolveAuth0Id(verified)) ?? verified
    const bundle = await buildAccountExport(accountAuth0Id)

    auditRoute(request, verified, 'settings.changed', 'account_export', accountAuth0Id, {
      format_version: bundle.formatVersion,
    })

    // No indent: this is a machine-consumed portability file, and on the 200-row
    // bundle `JSON.stringify(bundle, null, 2)` measured 36.4 ms / 22.58 MB against
    // 8.4 ms / 10.75 MB unindented — 4.3× the CPU and 2.1× the bytes for a
    // formatting choice no consumer of this attachment reads.
    return new Response(JSON.stringify(bundle), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${exportFilename()}"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  // Privacy requests are RECORDED, never executed: a delete cascades through
  // analyses, reports, videos and audit rows, so it is a reviewed request.
  .get('/api/me/privacy-requests', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const url = new URL(request.url)
    const raw = url.searchParams.get('limit')
    const requested = raw === null ? Number.NaN : Number(raw)
    // listPrivacyRequests owns the cap; an absent/garbage limit means "default".
    const requests = await listPrivacyRequests(verified, {
      limit: Number.isFinite(requested) ? requested : undefined,
    })

    set.status = 200
    return { requests }
  })
  .post('/api/me/privacy-requests', async ({ request, body, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified

    const validated = validatePrivacyRequestBody(body)
    if (!validated.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', validated.message, false)
    }

    const privacyRequest = await createPrivacyRequest(verified, validated.value.type)
    if (!privacyRequest) {
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to record privacy request', true)
    }

    auditRoute(request, verified, 'settings.changed', 'privacy_request', privacyRequest.id, {
      request_type: privacyRequest.type,
    })
    set.status = 201
    return { request: privacyRequest }
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
    // Shared with the org read routes (routes/org/attendance.ts) rather than a
    // second copy of the predicate: `from`/`to` reach a `::date` cast in both
    // `listAttendance` and `attendanceSummary`, so `?from=garbage` (and a blank
    // `?from=`) raised 22007 here and surfaced as a 500 for any linked player.
    // The window's `studentId` is deliberately ignored — the linked player row is
    // the only student this route may answer with.
    const window = attendanceWindow(url)
    if (!window.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid attendance filter', false)
    }

    // No "anchor at now" default, unlike `/api/me/schedule`: this query orders
    // `session_date desc`, so a cap keeps the MOST RECENT rows, which is the
    // history the hub is asking for. Attendance is also backward-looking, so
    // pinning `from` to today would drop every past session.
    const [records, summary] = await Promise.all([
      listAttendance(coachAuth0Id, {
        from: window.from,
        to: window.to,
        studentId: student.id,
        // Never null: an absent `limit` binds SQL NULL, which is UNLIMITED.
        limit: readListLimit(url),
      }),
      attendanceSummary(coachAuth0Id, {
        from: window.from,
        to: window.to,
        studentId: student.id,
      }),
    ])

    set.status = 200
    return { records, summary, linked: true }
  })

  // Team schedule (all events for the owning coach's org)
  .get('/api/me/schedule', async ({ request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const playerScopeResult = await playerScope(verified)
    const { coachAuth0Id } = playerScopeResult
    if (!coachAuth0Id) {
      set.status = 200
      return { events: [], linked: false }
    }

    const url = new URL(request.url)
    // Validated, because both reach a `::timestamptz` cast: `?from=garbage` (and
    // a blank `?from=`) used to raise 22007 here and surface as a 500.
    const window = scheduleWindow(url)
    if (!window.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid schedule filter', false)
    }
    // With neither bound the read is the owning club's ENTIRE fixture history,
    // oldest first and unbounded — and the one consumer (the player hub) filters
    // to upcoming anyway. Anchoring at now makes the default mean "what is coming
    // up", which is what the screen asks, and is what makes the row cap below
    // truncate nothing: a cap on an all-time window would keep the OLDEST page.
    const from = window.from ?? new Date().toISOString()

    // Scoped exactly as `/api/org/:auth0Id/schedule` already is: club-wide
    // fixtures (team_id is null) plus the viewer's own team. `listSchedule`'s
    // predicate is `team_id is null or team_id = any(...)`, so passing `[]` is
    // not "no filter" — it is the correct narrowing for an unassigned player,
    // who should see the club's fixtures and nobody else's team's. Omitting the
    // key entirely is what used to happen here, and it is the unscoped read.
    const viewerTeamIds = playerScopeResult.student?.team_id
      ? [playerScopeResult.student.team_id]
      : []

    const events = await listSchedule(coachAuth0Id, {
      from,
      to: window.to,
      teamIds: viewerTeamIds,
      limit: readListLimit(url),
    })
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
    // Same class of defect as the two routes above, and the same fix: these two
    // reach a `::timestamptz` cast inside `getStudentPerformanceSeries`, so
    // `?from=garbage` used to raise 22007 and 500 for any linked player.
    // `scheduleWindow` is the right predicate here — instants, not the bare
    // `YYYY-MM-DD` an attendance window takes — and it is the one the sibling
    // `/api/me/schedule` read already uses, so the two stay in step.
    const window = scheduleWindow(url)
    if (!window.ok) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid performance filter', false)
    }
    // No cap: the series is already narrowed to ONE student by the linked player
    // row, and `readListLimit` is a list-route ceiling, not a series cap.
    const points = await getStudentPerformanceSeries(coachAuth0Id, student.id, {
      from: window.from,
      to: window.to,
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
    const limit = pickInt(url.searchParams.get('limit'), { min: 1, max: 100, fallback: 50 })

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
    // Checked before the linked-player branch below, so the rule holds for every
    // caller: a malformed id is a 400, never a 500 from the `::uuid` cast inside
    // `getReport`. Placed here rather than after the branch because that branch
    // answers 200 without ever reading the id, which would let a malformed id
    // pass silently for exactly the unlinked callers most likely to mistype one.
    const reportId = pickUuid(params.id)
    if (!reportId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid report id', false)
    }
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { report: null, linked: false }
    }

    const report = await getReport(coachAuth0Id, reportId)
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

  // Self-service leave: the caller gives up their own membership. Always the
  // custodian path (no successor): their teams go back to the org owner and
  // the analyses they ran stay with the club. Refuses leaving your own org
  // and player self-removal (players are managed by their coach).
  .post('/api/me/orgs/:orgAuth0Id/leave', async ({ params, request, set }) => {
    const verified = requireVerifiedSelf({ request, set })
    if (typeof verified !== 'string') return verified
    const { orgAuth0Id } = params
    const primary = (await resolveAuth0Id(verified)) ?? verified
    if (!orgAuth0Id || orgAuth0Id === primary) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'You cannot leave your own organization', false)
    }
    const rowId = await findActiveMemberRowId(orgAuth0Id, primary)
    if (!rowId) {
      set.status = 404
      return buildError('NOT_FOUND', 'Membership not found', false)
    }
    const result = await offboardMember(orgAuth0Id, rowId, null, { self: true })
    if (!result) {
      set.status = 503
      return buildError('SERVICE_UNAVAILABLE', 'Membership service unavailable', true)
    }
    if (!result.ok) {
      if (result.status === 404) {
        set.status = 404
        return buildError('NOT_FOUND', result.error, false)
      }
      set.status = 400
      return buildError('INVALID_REQUEST', result.error, false)
    }
    auditRoute(request, orgAuth0Id, 'member.removed', 'org_member', rowId, {
      email: result.email,
      role: result.role,
      self: true,
      teams: result.teamIds,
    })
    for (const teamId of result.teamIds) {
      auditRoute(request, orgAuth0Id, 'team.member_removed', 'team', teamId, {
        membership: rowId,
        self: true,
      })
    }
    // Best-effort: the org owner learns a coach left.
    try {
      await notifyMembershipChanged({
        auth0Id: orgAuth0Id,
        title: 'A coach left the club',
        body: result.email ?? result.role,
        data: { href: '/dashboard/members' },
        dedupeKey: `member-left:${rowId}`,
      })
    } catch (error) {
      logger.warn('leave_notify_failed', {
        type: 'leave_notify_failed',
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
    set.status = 200
    return { left: true, teams: result.teamIds }
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
