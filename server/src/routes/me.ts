import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { getUserByAuth0Id, updateUserProfile, resolveAuth0Id } from '../lib/users'
import { admitAnalysis } from '../lib/admission'
import {
  decidePlayerAnalysis,
  resolvePlayerScope,
  withPlayerScope,
  withVerified,
} from '../lib/playerScope'
import { readJsonBody } from '../lib/capability'
import { attendanceSummary, listAttendance, listSchedule } from '../lib/orgAttendance'
import {
  getReport,
  getStudentAnalyses,
  getStudentPerformanceSeries,
  listReports,
} from '../lib/orgReports'
import { listObjectives } from '../lib/orgObjectives'
import { serviceGuard } from '../lib/serviceGuard'
import { UUID_RE } from './org/shared'
import { redactWellness } from '../lib/permissions'
import { listMembershipsForUser } from '../lib/orgMembers'
import { mintAttributionToken } from '../lib/attribution'
import { checkLimit } from '../lib/ratelimit'
import { acceptInvite } from '../lib/invites'
import { auditRoute } from '../lib/audit'

export default new Elysia()
  .use(serviceGuard)

  // Org context: which orgs does the verified caller belong to (as owner or
  // member)? The web app uses the primary one to scope every /api/org|email and
  // /api/auth/user call, so invited coaches see the org they belong to instead
  // of an empty org keyed by their own sub.
  .get('/api/me/orgs', async ({ request, set }) => {
    return withVerified(request, set, async (verified) => {
      // Linked accounts: the caller may sign in via a secondary provider, but
      // memberships are keyed by the primary auth0_id.
      const primary = (await resolveAuth0Id(verified)) ?? verified
      const orgs = await listMembershipsForUser(primary)
      set.status = 200
      return { orgs }
    })
  })

  // Own profile: user record + linked student (if any)
  .get('/api/me/profile', async ({ request, set }) => {
    return withVerified(request, set, async (verified) => {
      const { accountAuth0Id, student, coachAuth0Id } = await resolvePlayerScope(verified)
      const user = await getUserByAuth0Id(accountAuth0Id)

      set.status = 200
      return { user, student, coach_auth0_id: coachAuth0Id }
    })
  })

  // Update own profile (name, nickname, picture)
  .put('/api/me/profile', async ({ body, request, set }) => {
    return withVerified(request, set, async (verified) => {
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
  })

  // Own attendance history + summary (joined with the linked player scope)
  .get('/api/me/attendance', async ({ request, set }) => {
    return withPlayerScope(
      request,
      set,
      { records: [], summary: null, linked: false },
      async ({ student, coachAuth0Id }) => {
        const url = new URL(request.url)
        const from = url.searchParams.get('from') ?? undefined
        const to = url.searchParams.get('to') ?? undefined

        const [records, summary] = await Promise.all([
          listAttendance(coachAuth0Id, { from, to, studentId: student.id }),
          attendanceSummary(coachAuth0Id, { from, to, studentId: student.id }),
        ])

        set.status = 200
        return { records, summary, linked: true }
      },
    )
  })

  // Team schedule (all events for the owning coach's org)
  .get('/api/me/schedule', async ({ request, set }) => {
    return withPlayerScope(
      request,
      set,
      { events: [], linked: false },
      async ({ coachAuth0Id }) => {
        const url = new URL(request.url)
        const from = url.searchParams.get('from') ?? undefined
        const to = url.searchParams.get('to') ?? undefined

        const events = await listSchedule(coachAuth0Id, { from, to })
        set.status = 200
        return { events, linked: true }
      },
    )
  })

  // Own performance trends (analysis form scores + any manual metrics)
  .get('/api/me/performance', async ({ request, set }) => {
    return withPlayerScope(
      request,
      set,
      { points: [], linked: false },
      async ({ student, coachAuth0Id }) => {
        const url = new URL(request.url)
        const from = url.searchParams.get('from') ?? undefined
        const to = url.searchParams.get('to') ?? undefined

        const points = await getStudentPerformanceSeries(coachAuth0Id, student.id, {
          from,
          to,
        })
        set.status = 200
        return { points, linked: true }
      },
    )
  })

  // Own training objectives (read-only player view of the coaching loop)
  .get('/api/me/objectives', async ({ request, set }) => {
    return withPlayerScope(
      request,
      set,
      { objectives: [], linked: false },
      async ({ student, coachAuth0Id }) => {
        const objectives = await listObjectives(coachAuth0Id, { studentId: student.id })
        set.status = 200
        return { objectives, linked: true }
      },
    )
  })

  // Own analyses (analysis_history rows linked to the player's student row)
  .get('/api/me/analyses', async ({ request, set }) => {
    return withPlayerScope(
      request,
      set,
      { analyses: [], linked: false },
      async ({ student, coachAuth0Id }) => {
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
      },
    )
  })

  // Reports that mention me (student-scoped)
  .get('/api/me/reports', async ({ request, set }) => {
    return withPlayerScope(
      request,
      set,
      { reports: [], linked: false },
      async ({ student, coachAuth0Id }) => {
        const reports = await listReports(coachAuth0Id, { studentId: student.id })
        set.status = 200
        return { reports, linked: true }
      },
    )
  })

  .get('/api/me/reports/:id', async ({ request, params, set }) => {
    return withPlayerScope(
      request,
      set,
      { report: null, linked: false },
      async ({ student, coachAuth0Id }) => {
        const report = await getReport(coachAuth0Id, params.id)
        if (!report || report.student_id !== student.id) {
          set.status = 404
          return buildError('NOT_FOUND', 'Report not found', false)
        }

        set.status = 200
        return { report, linked: true }
      },
    )
  })

  // Self-scoped analysis kickoff: the player uploads/scans a video through the
  // capability endpoints (scan.ts), then starts the analysis here. The job is
  // persisted under the LINKED coach's auth0Id (so it appears in the coach's
  // dashboard history) with requested_by = the player, and is linked to the
  // player's student row so it shows up in /api/me/analyses.
  .post('/api/me/analyze', async ({ request, set }) => {
    return withVerified(request, set, async (verified) => {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        set.status = parsed.status
        return parsed.body
      }
      const body = parsed.body

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

      const scope = await resolvePlayerScope(verified)
      const decision = decidePlayerAnalysis({
        verifiedAuth0Id: verified,
        playerScope: scope,
      })
      if (!decision.ok) {
        set.status = decision.status
        return decision.error
      }

      // Admission (rate → validate → quota → tier → persist → enqueue → usage)
      // lives in lib/admission; this route maps outcomes to HTTP. The roster
      // scope keeps quota/tier/priority/owners on the owning coach's org.
      try {
        const outcome = await admitAnalysis({
          request,
          body: {
            session_token: sessionToken,
            player_index: playerIndex,
            video_key: videoKey,
            angle,
          },
          roster: {
            coachAuth0Id: decision.coachAuth0Id,
            requestedBy: decision.requestedBy,
            studentId: decision.studentId,
          },
        })
        if (!outcome.ok) {
          set.status = outcome.status
          return outcome.body
        }
        set.status = 200
        return { job_id: outcome.serverJobId }
      } catch (error) {
        if (error instanceof Error && error.message === 'QUEUE_UNAVAILABLE') {
          set.status = 503
          return buildError('QUEUE_UNAVAILABLE', 'Job queue is not configured.', true)
        }
        console.error(
          JSON.stringify({
            type: 'me_analyze_enqueue_error',
            message: (error as Error)?.message,
            timestamp: new Date().toISOString(),
          }),
        )
        set.status = 500
        return buildError(
          'INTERNAL_ERROR',
          'Failed to enqueue analysis job. Please try again.',
          true,
        )
      }
    })
  })

  // Accept an organization invitation: the verified caller redeems a
  // single-use token minted for their email. Links their account on success.
  .post('/api/me/invites/accept', async ({ request, set }) => {
    return withVerified(request, set, async (verified) => {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        set.status = parsed.status
        return parsed.body
      }
      const token = parsed.body.token
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
  })

  // Mint a short-lived attribution token binding the verified session sub.
  // Browser-direct capability routes (scan/analyze) receive it as `x-attribution`
  // and the server resolves the caller from the signed sub — never from a raw
  // client header. Requires the identity boundary (x-verified-auth0-id), so an
  // attacker cannot mint tokens for a sub they are not signed in as.
  .get('/api/me/attribution/mint', async ({ request, set }) => {
    return withVerified(request, set, async (verified) => {
      // Each mint is a fresh 10-minute bearer: cap mints per session sub so
      // a compromised session cannot hold a persistent exfil channel open.
      // The web caches until expiry, so legitimate use mints rarely.
      const { allowed } = await checkLimit({
        key: `rl:attribution-mint:${verified}`,
        limit: parseInt(process.env.ATTRIBUTION_MINT_RATE_LIMIT ?? '60', 10),
        windowSec: 3600,
      })
      if (!allowed) {
        set.status = 429
        return buildError('RATE_LIMITED', 'Too many token requests. Try again later.', true)
      }
      const minted = mintAttributionToken(verified)
      if (!minted) {
        set.status = 503
        return buildError('SERVICE_NOT_CONFIGURED', 'Attribution signing is not configured.', true)
      }
      set.status = 200
      return minted
    })
  })
