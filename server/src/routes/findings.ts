import { Elysia } from 'elysia'

import {
  findingsToCsv,
  getFindingJobId,
  getFindingsTrend,
  getStudentFindings,
  reviewFinding,
} from '../lib/findings'
import { buildError } from '../lib/errors'
import { serviceGuard } from '../lib/serviceGuard'
import { resolveCaller } from '../lib/caller'
import { accountJobScope, accountStudentReadable, resolveAccountScope } from '../lib/accountScope'
import { canSeeStudent } from '../lib/org/scope'
import { UUID_RE } from '../lib/uuid'

// Findings routes (split from routes/auth.ts). The read routes and the review
// mutation are separate instances so the composer can mount them at the exact
// positions they occupied in the original route table.

export type FindingsTrendQuery = {
  days: number
  category: string | null
  severity: string | null
  studentId: string | null
  teamId: string | null
}

/**
 * Pure parser for the findings-trends query string. Bounds days to 1..365,
 * strips text filters to a safe alphabet, and accepts only well-formed UUIDs
 * for id filters (they are interpolated as bound parameters, but tight input
 * keeps logs/URLs clean).
 */
export const parseFindingsTrendQuery = (params: URLSearchParams): FindingsTrendQuery => {
  const daysRaw = Number(params.get('days') || 30)
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 30
  const clean = (v: string | null): string | null => {
    if (!v) return null
    const t = v
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_ -]/g, '')
      .slice(0, 60)
    return t || null
  }
  const uuid = (v: string | null): string | null => {
    const t = v?.trim() ?? ''
    return UUID_RE.test(t) ? t : null
  }
  return {
    days,
    category: clean(params.get('category')),
    severity: clean(params.get('severity')),
    studentId: uuid(params.get('student_id')),
    teamId: uuid(params.get('team_id')),
  }
}

// Read routes: trends, list, CSV export.
export const findingsReadRoutes = new Elysia()
  .use(serviceGuard)
  .get('/api/auth/user/:auth0Id/findings/trends', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }

    const url = new URL(request.url)
    const query = parseFindingsTrendQuery(url.searchParams)
    // A trend query is scoped three ways, and each filter is a chance to read
    // past the caller's team: a named student, a named team, or — with neither —
    // the whole org, which is what this route used to be for everyone.
    const { caller, visible } = await resolveAccountScope(auth0Id, request)
    if (query.studentId) {
      if (visible !== null && !canSeeStudent(visible, query.studentId)) {
        set.status = 404
        return buildError('NOT_FOUND', 'Student not found', false)
      }
    } else if (query.teamId) {
      if (!caller.canAccessTeam(query.teamId)) {
        set.status = 404
        return buildError('NOT_FOUND', 'Team not found', false)
      }
    } else if (visible !== null) {
      set.status = 403
      return buildError(
        'FORBIDDEN',
        'Org-wide findings trends cannot be read from a team account',
        false,
      )
    }
    const trends = await getFindingsTrend(auth0Id, query)
    set.status = 200
    return { trends }
  })
  .get('/api/auth/user/:auth0Id/findings', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const studentId = url.searchParams.get('student_id') ?? ''
    if (!UUID_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a valid UUID', false)
    }
    // A UUID is a shape, not a permission: without this a team coach could read
    // any player's findings by passing their id.
    const gate = await accountStudentReadable(auth0Id, studentId, request)
    if (!gate.ok) {
      set.status = gate.status
      return gate.error
    }
    const limitRaw = Number(url.searchParams.get('limit') || 50)
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50
    set.status = 200
    return { findings: await getStudentFindings(auth0Id, studentId, limit) }
  })
  .get('/api/auth/user/:auth0Id/findings/export', async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing auth0Id parameter', false)
    }
    const url = new URL(request.url)
    const studentId = url.searchParams.get('student_id') ?? ''
    if (!UUID_RE.test(studentId)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a valid UUID', false)
    }
    // Same gate as the list: this one is a CSV, so it is the more valuable of the
    // two to leave unrefused.
    const gate = await accountStudentReadable(auth0Id, studentId, request)
    if (!gate.ok) {
      set.status = gate.status
      return gate.error
    }
    const limitRaw = Number(url.searchParams.get('limit') || 200)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200
    const findings = await getStudentFindings(auth0Id, studentId, limit)
    set.status = 200
    set.headers['content-type'] = 'text/csv; charset=utf-8'
    set.headers['content-disposition'] = `attachment; filename="findings-${studentId}.csv"`
    return `\ufeff${findingsToCsv(findings)}`
  })

// Coach review of a finding (approve/flag). Requires the finding.review
// permission: owner self-passes; members resolve via org role.
export const findingsReviewRoutes = new Elysia()
  .use(serviceGuard)
  .patch('/api/auth/user/:auth0Id/findings/:findingId', async ({ params, body, request, set }) => {
    const { auth0Id, findingId } = params
    if (!auth0Id || !findingId) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Missing required parameters', false)
    }
    const { review_state } = (body ?? {}) as { review_state?: unknown }
    if (review_state !== 'approved' && review_state !== 'flagged') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'review_state must be approved or flagged', false)
    }
    const caller = await resolveCaller(auth0Id, request)
    if (!caller.verified) {
      set.status = 403
      return buildError('FORBIDDEN', 'Missing verified identity', false)
    }
    if (caller.verified !== auth0Id && !caller.can('finding.review')) {
      set.status = 403
      return buildError('FORBIDDEN', 'Finding review requires the finding.review permission', false)
    }
    // The permission says who may review; this says whose. A finding hangs off an
    // analysis, so the player comes from that analysis, and approving a finding
    // about another team's player is a write on their record — 403, not 404.
    const { found, serverJobId } = await getFindingJobId(auth0Id, findingId)
    if (!found || !serverJobId) {
      set.status = 404
      return buildError('NOT_FOUND', 'Finding not found', false)
    }
    const gate = await accountJobScope(auth0Id, serverJobId, request, 'write', caller)
    if (!gate.ok) {
      set.status = gate.status
      return gate.error
    }
    const updated = await reviewFinding(auth0Id, findingId, review_state)
    if (!updated) {
      set.status = 404
      return buildError('NOT_FOUND', 'Finding not found or already reviewed', false)
    }
    set.status = 200
    return { id: findingId, review_state }
  })
