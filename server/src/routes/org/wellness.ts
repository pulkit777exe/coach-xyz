import { createWellnessCheckin, listWellness } from '../../lib/orgData'
import { resolveCaller } from '../../lib/caller'
import { canSeeStudent, visibleStudentIds } from '../../lib/org/scope'
import { auditRoute } from '../../lib/audit'
import { UUID_RE } from './shared'
import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

// Both handlers resolve to exactly one student, so both answers are checked:
// the §5 medical boundary (who may see health data at all) and then team scope
// (which players that is true of). The medical check stays first and keeps its
// own message — it is the coarser boundary, and reordering it would change the
// answer a non-medical caller already gets. Neither is duplicated: the write
// additionally carries the scope into `createWellnessCheckin`, whose student
// lookup refuses an out-of-scope id on its own.
export default new Elysia()
  .use(serviceGuard)
  // ── Wellness check-ins (health data, §5) ─────────────────────────────────
  // Reads require the medical permission; writes require player.manage.
  // The AI layer reports wellness observations verbatim — never diagnoses.
  .get('/api/org/:auth0Id/students/:id/wellness', async ({ params, request, set }) => {
    const { auth0Id, id: studentId } = params
    if (!auth0Id || !studentId || !UUID_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.can('medical.read')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Reading wellness data requires the medical permission', false)
    }
    // Wellness rows are health data, so the student has to be in scope as well.
    // 403 rather than the 404 used for roster reads: the only roles that clear
    // the medical boundary above are org-wide by policy (owner, medical), so
    // this cannot be used to probe another team's roster.
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    if (!canSeeStudent(studentIds, studentId)) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Wellness data is limited to the students in your team scope',
        false,
      )
    }
    auditRoute(request, auth0Id, 'health.record_viewed', 'student', studentId)
    set.status = 200
    return { checkins: await listWellness(auth0Id, studentId) }
  })
  .post('/api/org/:auth0Id/students/:id/wellness', async ({ params, body, request, set }) => {
    const { auth0Id, id: studentId } = params
    if (!auth0Id || !studentId || !UUID_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid student id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const verified = caller.verified
    if (!caller.can('player.manage')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Recording wellness data requires player.manage', false)
    }
    // Refuse before the store: no check-in is attempted for a player outside the
    // caller's teams, so nothing lands and nothing is echoed back.
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    if (!canSeeStudent(studentIds, studentId)) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Wellness data is limited to the students in your team scope',
        false,
      )
    }
    const raw = (body ?? {}) as Record<string, unknown>
    const checkin = await createWellnessCheckin(
      auth0Id,
      verified,
      {
        student_id: studentId,
        sleep_hours: typeof raw.sleep_hours === 'number' ? raw.sleep_hours : null,
        fatigue: typeof raw.fatigue === 'number' ? raw.fatigue : null,
        pain: typeof raw.pain === 'string' ? raw.pain : null,
        availability: typeof raw.availability === 'string' ? raw.availability : null,
        note: typeof raw.note === 'string' ? raw.note : null,
      },
      caller.studentScope,
    )
    if (!checkin) {
      set.status = 404
      return buildError('NOT_FOUND', 'Student not found', false)
    }
    set.status = 201
    return { checkin }
  })
