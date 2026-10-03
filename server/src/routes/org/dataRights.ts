import { Elysia } from 'elysia'

import { buildError } from '../../lib/errors'
import { serviceGuard } from '../../lib/serviceGuard'
import { resolveCaller, type Caller } from '../../lib/caller'
import { auditRoute } from '../../lib/audit'
import { UUID_RE } from './shared'
import {
  buildOrgExport,
  orgExportSectionToCsv,
  ORG_EXPORT_FORMAT_VERSION,
  ORG_EXPORT_SECTIONS,
  type OrgExportSection,
} from '../../lib/orgExport'
import { deleteAnalysis } from '../../lib/analyses'
import { deleteStudent, getLinkedPlayer, getStudentAnalyses } from '../../lib/orgData'
import { deleteConsent } from '../../lib/consents'
import { deleteNotificationsForAccount } from '../../lib/notifications'
import {
  getPrivacyRequest,
  listOrgPrivacyRequests,
  setPrivacyRequestStatus,
  PRIVACY_REQUEST_STATUSES,
  type PrivacyRequestStatus,
} from '../../lib/privacyRequests'
import { logger } from '../../lib/logger'

const SECTION_SET: ReadonlySet<string> = new Set(ORG_EXPORT_SECTIONS)
const PRIVACY_STATUS_SET: ReadonlySet<string> = new Set(PRIVACY_REQUEST_STATUSES)

/** Owner/admin floor: the export and review queue are club-level, not roster reads. */
const requireOwnerAdmin = (
  caller: Caller,
  set: { status?: number | string },
): { ok: true } | { ok: false; error: ReturnType<typeof buildError> } => {
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    set.status = 403
    return {
      ok: false,
      error: buildError('FORBIDDEN', 'Organization export requires owner or admin', false),
    }
  }
  return { ok: true }
}

export default new Elysia()
  .use(serviceGuard)
  // ── Org export (reviewed, not automatic) ──────────────────────────────────
  .get('/api/org/:auth0Id/export', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const floor = requireOwnerAdmin(caller, set)
    if (!floor.ok) return floor.error
    const url = new URL(request.url)
    const format = url.searchParams.get('format') ?? 'json'
    if (format !== 'json' && format !== 'csv') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'format must be json or csv', false)
    }
    const sectionRaw = url.searchParams.get('section')
    if (format === 'csv' && (sectionRaw === null || !SECTION_SET.has(sectionRaw))) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `section must be one of ${ORG_EXPORT_SECTIONS.join(', ')}`,
        false,
      )
    }
    // Wellness rides only for roles holding medical.read: owners see it,
    // admins do not (their permission set excludes it by design).
    const bundle = await buildOrgExport(auth0Id, {
      includeWellness: caller.can('medical.read'),
    })
    auditRoute(request, auth0Id, 'report.exported', 'org_export', null, {
      format,
      section: sectionRaw,
      format_version: ORG_EXPORT_FORMAT_VERSION,
    })
    if (format === 'csv') {
      const csv = orgExportSectionToCsv(sectionRaw as OrgExportSection, bundle)
      return new Response(`\uFEFF${csv}`, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="coachxyz-${sectionRaw}-export.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    // No indent, same as GET /api/me/export: a machine-consumed portability file
    // where the 2-space form doubles the bytes and quadruples the stringify cost
    // for nothing a consumer reads.
    return new Response(JSON.stringify(bundle), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="coachxyz-org-export.json"`,
        'Cache-Control': 'no-store',
      },
    })
  })
  // ── Privacy-request review queue ──────────────────────────────────────────
  .get('/api/org/:auth0Id/privacy-requests', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const floor = requireOwnerAdmin(caller, set)
    if (!floor.ok) return floor.error
    set.status = 200
    return { requests: await listOrgPrivacyRequests(auth0Id) }
  })
  .patch('/api/org/:auth0Id/privacy-requests/:id', async ({ params, body, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid privacy request id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const floor = requireOwnerAdmin(caller, set)
    if (!floor.ok) return floor.error
    const { status } = (body ?? {}) as { status?: unknown }
    if (typeof status !== 'string' || !PRIVACY_STATUS_SET.has(status)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        `status must be one of ${PRIVACY_REQUEST_STATUSES.join(', ')}`,
        false,
      )
    }
    // The queue is the scope: a request from outside this org is 404 here,
    // indistinguishable from one that does not exist.
    const queue = await listOrgPrivacyRequests(auth0Id)
    if (!queue.some((r) => r.id === id)) {
      set.status = 404
      return buildError('NOT_FOUND', 'Privacy request not found', false)
    }
    const updated = await setPrivacyRequestStatus(id, status as PrivacyRequestStatus)
    if (!updated) {
      set.status = 422
      return buildError('INVALID_REQUEST', 'Illegal status transition', false)
    }
    auditRoute(request, auth0Id, 'settings.changed', 'privacy_request', id, {
      status,
    })
    set.status = 200
    return { request: updated }
  })
  .post('/api/org/:auth0Id/privacy-requests/:id/execute-delete', async ({ params, request, set }) => {
    const { auth0Id, id } = params
    if (!auth0Id || !id || !UUID_RE.test(id)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Invalid privacy request id', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    const floor = requireOwnerAdmin(caller, set)
    if (!floor.ok) return floor.error
    const queue = await listOrgPrivacyRequests(auth0Id)
    const target = queue.find((r) => r.id === id) ?? (await getPrivacyRequest(id))
    if (!target || !queue.some((r) => r.id === id)) {
      set.status = 404
      return buildError('NOT_FOUND', 'Privacy request not found', false)
    }
    if (target.type !== 'delete') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Only delete requests can be executed', false)
    }
    // Nothing runs without a human click first: the request must have been
    // moved received → in_progress through the review action above.
    if (target.status !== 'in_progress') {
      set.status = 422
      return buildError('INVALID_REQUEST', 'Move the request to in_progress first', false)
    }
    // The linked player row is the erasure root; without one there is no
    // org-held player data to erase for this account.
    const linked = await findLinkedStudent(auth0Id, target.auth0Id)
    if (!linked) {
      set.status = 404
      return buildError('NOT_FOUND', 'No linked player for this request', false)
    }
    try {
      // Projected read is enough here and is the point: this loop only needs
      // `server_job_id`, and it runs over every analysis the player has.
      const analyses = await getStudentAnalyses(auth0Id, linked, 200)
      for (const analysis of analyses) {
        await deleteAnalysis(auth0Id, analysis.server_job_id)
      }
      await deleteStudent(auth0Id, linked)
      await deleteNotificationsForAccount(target.auth0Id)
      await deleteConsent(linked)
      await setPrivacyRequestStatus(id, 'completed')
    } catch (error) {
      logger.error('privacy_execute_failed', {
        type: 'privacy_execute_failed',
        org: auth0Id,
        request: id,
        error: error instanceof Error ? error.message : 'unknown',
      })
      set.status = 500
      return buildError('INTERNAL_ERROR', 'Failed to execute deletion', true)
    }
    auditRoute(request, auth0Id, 'settings.changed', 'privacy_request', id, {
      executed: true,
      student_id: linked,
    })
    set.status = 200
    return { executed: true }
  })

/** The student row linked to an account inside this org, if any. */
const findLinkedStudent = async (orgAuth0Id: string, accountAuth0Id: string) => {
  const linked = await getLinkedPlayer(accountAuth0Id)
  return linked && linked.coachAuth0Id === orgAuth0Id ? linked.student.id : null
}
