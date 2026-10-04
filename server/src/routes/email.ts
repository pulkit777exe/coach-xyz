import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import {
  emailConfigured,
  sendEmail,
  inviteEmail,
  reportEmail,
  attendanceEmail,
  escapeHtml,
  isDeliverableAddress,
} from '../lib/mailer'
import { getUserByAuth0Id } from '../lib/users'
import { resolveCaller, type Caller } from '../lib/caller'
import type { OrgMemberRole } from '../lib/orgMembers'
import { canSeeStudent, visibleStudentIds } from '../lib/org/scope'
import type { Permission } from '../lib/permissions'
import { listStudents, getStudent, getReport, listAttendance } from '../lib/orgData'
import { serviceGuard } from '../lib/serviceGuard'
import { auditRoute } from '../lib/audit'
import { checkEmailLimit, rateLimited } from '../lib/ratelimit'
import { logger } from '../lib/logger'

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'

// Resend onboarding domain is forced for unverified accounts; the app domain
// is used once a domain is verified in the dashboard (see src/lib/mailer.ts).
const statusColor = (status: string): string => {
  switch (status) {
    case 'present':
      return '#046C0C'
    case 'late':
      return '#c49a2b'
    case 'absent':
      return '#CC5728'
    default:
      return '#7a6e62'
  }
}

/**
 * Capability gate for the org email routes.
 *
 * `serviceGuard` only proves the caller is *a* member of the org named in the
 * path — membership, not authorization. With nothing else here, any member
 * could use these routes as an exfiltration channel: `attendance` returns the
 * whole club's attendance when `student_id` is omitted, `report` returns any
 * report by id, and both mail the contents to an address the caller chooses.
 * That bypassed the permission matrix *and* team scope, and hiding the button in
 * the UI did nothing about it.
 *
 * So: one capability per route, checked once, before any data is read.
 */
/**
 * The `/api/email/*` tree's role floor.
 *
 * This list used to live at `app.ts` as `emailRoute.use(orgRoleGuard([...]))` — a
 * mount-time guard wrapped around an ALREADY-COMPOSED barrel, a shape Elysia never
 * applies to those routes. It read as enforcement and enforced nothing, which is
 * worse than having no guard: it is what makes the list below look like the rule
 * when the actual rule is the capability inside `emailGuard`. Four independent
 * audits of this tree each read the list, derived a role floor from it, and had to
 * be corrected by experiment.
 *
 * The two disagree on exactly one role, and the disagreement is a PRODUCT
 * QUESTION rather than an obvious bug — so it is recorded here instead of silently
 * resolved. `analyst` holds `report.create`, so on `POST /api/email/:auth0Id/report`
 * it passes the capability gate, reads any report in the org through an unscoped
 * `getReport`, and mails it to a caller-supplied `to`. The list above excludes it;
 * `emailRouteGuards.test.ts` asserts it may ("report.create is theirs by policy"),
 * reasoning that an analyst is an org-wide reader already and gains nothing. That
 * reasoning holds — the same analyst can read every report through a plain
 * `GET /api/org/:auth0Id/reports/:id` — so egress is the only thing at stake, and
 * egress is exactly why this repo's own notes call an unguarded email route an
 * exfiltration channel. It needs an owner's decision, not an auditor's.
 *
 * What is NOT in doubt: these routes mail data to an address the caller supplies.
 */
export const EMAIL_TREE_ROLES_NOT_ENFORCED = [
  'owner',
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
] as const satisfies readonly OrgMemberRole[]

const emailGuard = async (
  auth0Id: string,
  request: Request,
  permission: Permission,
  action: string,
): Promise<{ ok: true; caller: Caller } | { ok: false; body: ReturnType<typeof buildError> }> => {
  const caller = await resolveCaller(auth0Id, request)
  if (!caller.can(permission)) {
    return {
      ok: false,
      body: buildError('FORBIDDEN', `${action} requires the ${permission} permission`, false),
    }
  }
  return { ok: true, caller }
}

export default new Elysia()
  .use(serviceGuard)
  // ── Invite players by email ────────────────────────────────────────────
  // body: { emails: string[], student_ids?: string[] }
  // Creates missing student rows (arm-band email only, no account link),
  // then emails each address an invitation with a signup link.
  .post('/api/email/:auth0Id/invite', async ({ params, body, request, set }) => {
    const auth0Id = params.auth0Id as string
    // Org-branded signup invites are an owner/admin capability, not a member's:
    // any member could otherwise send them, using the club's name, to anyone.
    const guard = await emailGuard(auth0Id, request, 'org.invite', 'Sending invites')
    if (!guard.ok) {
      set.status = 403
      return guard.body
    }
    const { allowed: emailOk, remaining } = await checkEmailLimit(auth0Id)
    set.headers['X-RateLimit-Remaining'] = String(remaining)
    if (!emailOk) {
      return rateLimited(
        set,
        'Daily email limit reached for this organization. Try again tomorrow.',
      )
    }
    const { emails, student_ids } = body as {
      emails?: unknown
      student_ids?: unknown
    }

    if (!Array.isArray(emails) || emails.length === 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Provide at least one email address.', false)
    }
    const addresses = emails
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => isDeliverableAddress(e))
    if (addresses.length === 0) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Provide at least one valid email address.', false)
    }

    const owner = await getUserByAuth0Id(auth0Id)
    // RAW, not escaped. The templates own escaping, because only they know which
    // of their uses is HTML and which is plain text — and they use `coachName` in
    // the subject as well. Pre-escaping here put `&amp;` into every subject line.
    const coachName = owner?.name ?? 'Your coach'
    const teamName =
      `${owner?.nickname || owner?.name || 'Your'} Team`.replace(/\.\s*$/, '') + "'s Team"

    if (!emailConfigured()) {
      set.status = 501
      return buildError(
        'EMAIL_NOT_CONFIGURED',
        'Email sending is not configured (missing RESEND_API_KEY).',
        false,
      )
    }

    // Optional student linking: map emails → students so invites can be tracked.
    const linkMap = new Map<string, string>()
    if (Array.isArray(student_ids)) {
      const students = await listStudents(auth0Id, {})
      for (const sid of student_ids) {
        if (typeof sid !== 'string') continue
        const student = students.find((s) => s.id === sid)
        if (student?.email) linkMap.set(student.email.toLowerCase(), student.id)
      }
    }

    const inviteUrl = `${FRONTEND_URL}/signup`

    const sent: { to: string; ok: boolean }[] = []
    for (const email of addresses) {
      try {
        const { subject, html, text } = inviteEmail(coachName, teamName, inviteUrl)
        await sendEmail({ to: email, subject, html, text })
        sent.push({ to: email, ok: true })
      } catch (err) {
        sent.push({ to: email, ok: false })
        logger.error('email_invite_failed', {
          type: 'email_invite_failed',
          to: email,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const okCount = sent.filter((s) => s.ok).length
    if (okCount === 0) {
      set.status = 502
      return buildError(
        'EMAIL_SEND_FAILED',
        'Invites could not be sent. Check the configured domain and key.',
        true,
      )
    }
    set.status = 200
    return { sent, total: sent.length, failed: sent.length - okCount }
  })

  // ── Email a report to a recipient ───────────────────────────────────────
  // body: { report_id: string, to?: string }  — `to` defaults to the student's email
  .post('/api/email/:auth0Id/report', async ({ params, body, request, set }) => {
    const auth0Id = params.auth0Id as string
    // Sending a report mails it out, so it is an authoring capability
    // (`report.create`) rather than the read a player legitimately has.
    const guard = await emailGuard(auth0Id, request, 'report.create', 'Emailing a report')
    if (!guard.ok) {
      set.status = 403
      return guard.body
    }
    const visible = await visibleStudentIds(auth0Id, guard.caller.studentScope)
    const { allowed: emailOk } = await checkEmailLimit(auth0Id)
    if (!emailOk) {
      return rateLimited(
        set,
        'Daily email limit reached for this organization. Try again tomorrow.',
      )
    }
    const { report_id, to } = body as { report_id?: unknown; to?: unknown }

    if (typeof report_id !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'Provide a report_id.', false)
    }
    if (!emailConfigured()) {
      set.status = 501
      return buildError(
        'EMAIL_NOT_CONFIGURED',
        'Email sending is not configured (missing RESEND_API_KEY).',
        false,
      )
    }

    const report = await getReport(auth0Id, report_id)
    if (!report) {
      set.status = 404
      return buildError('NOT_FOUND', 'Report not found.', false)
    }
    // A report about a student the caller cannot see must not be mailed out,
    // and a student-less report summarizes the whole org — so a scoped caller
    // cannot send one either. Mirrors the guard on POST/PUT /reports.
    if (report.student_id) {
      if (!canSeeStudent(visible, report.student_id)) {
        set.status = 403
        return buildError('FORBIDDEN', 'That report is outside your team scope', false)
      }
    } else if (visible !== null) {
      set.status = 403
      return buildError('FORBIDDEN', 'Org-wide reports cannot be sent from a team account', false)
    }

    // A caller-supplied `to` is honoured ONLY for a scoped caller. `visible` is
    // null exactly when the caller is org-wide (owner/admin/analyst), and that is
    // the case worth closing: such a caller can already read every report in the
    // org through `GET /api/org/:auth0Id/reports/:id`, so letting them redirect one
    // to an address of their choosing converts read access into egress — the exact
    // channel an unguarded mail route is. They mail the student's own address
    // instead, which is the action they actually meant.
    //
    // This is the compromise between the two positions this route sat between: the
    // role floor in `app.ts` (which excludes `analyst` and never fires) and the
    // capability in `emailGuard` (which admits `analyst` on `report.create`, and is
    // asserted by `emailRouteGuards.test.ts`). The capability stands; the arbitrary
    // recipient does not.
    let recipient = visible !== null && typeof to === 'string' ? to.trim() : ''
    let studentName = 'Athlete'
    if (report.student_id) {
      const student = await getStudent(auth0Id, report.student_id)
      if (student) {
        studentName = student.full_name
        if (!recipient && student.email) recipient = student.email
      }
    }
    if (!isDeliverableAddress(recipient)) {
      set.status = 400
      return buildError(
        'INVALID_REQUEST',
        visible === null
          ? 'No valid recipient: an org-wide account mails the student, so this report needs the student to have an email address.'
          : 'No valid recipient for this report (student has no email and no `to` given).',
        false,
      )
    }

    const content = (report.content_json ?? {}) as { summary?: string | null }
    const summary = content.summary
      ? content.summary.slice(0, 600)
      : 'Open the report to view the full breakdown.'

    const reportUrl = `${FRONTEND_URL}/dashboard/reports/${report_id}`
    try {
      const { subject, html, text } = reportEmail(studentName, report.title, summary, reportUrl)
      const sent = await sendEmail({ to: recipient, subject, html, text })
      auditRoute(request, auth0Id, 'report.exported', 'report', report_id, { to: recipient })
      set.status = 200
      return { sent }
    } catch (err) {
      logger.error('email_report_failed', {
        type: 'email_report_failed',
        report_id,
        error: err instanceof Error ? err.message : String(err),
      })
      set.status = 502
      return buildError('EMAIL_SEND_FAILED', 'Report could not be emailed.', true)
    }
  })

  // ── Email an attendance sheet ───────────────────────────────────────────
  // body: { student_id?: string, from?: string, to?: string, to?: string }
  .post('/api/email/:auth0Id/attendance', async ({ params, body, request, set }) => {
    const auth0Id = params.auth0Id as string
    const guard = await emailGuard(
      auth0Id,
      request,
      'attendance.write',
      'Emailing an attendance sheet',
    )
    if (!guard.ok) {
      set.status = 403
      return guard.body
    }
    // Omitting student_id means "the whole period", so the read must be capped
    // at the caller's scope or it returns every team's attendance.
    const visible = await visibleStudentIds(auth0Id, guard.caller.studentScope)
    const { allowed: emailOk } = await checkEmailLimit(auth0Id)
    if (!emailOk) {
      return rateLimited(
        set,
        'Daily email limit reached for this organization. Try again tomorrow.',
      )
    }
    const { student_id, from, to, recipient } = body as {
      student_id?: unknown
      from?: unknown
      to?: unknown
      recipient?: unknown
    }
    if (!emailConfigured()) {
      set.status = 501
      return buildError(
        'EMAIL_NOT_CONFIGURED',
        'Email sending is not configured (missing RESEND_API_KEY).',
        false,
      )
    }

    if (student_id !== undefined && student_id !== null && typeof student_id !== 'string') {
      set.status = 400
      return buildError('INVALID_REQUEST', 'student_id must be a string.', false)
    }
    if (typeof student_id === 'string' && !canSeeStudent(visible, student_id)) {
      set.status = 403
      return buildError('FORBIDDEN', 'That student is outside your team scope', false)
    }

    const records = await listAttendance(auth0Id, {
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
      studentId: typeof student_id === 'string' ? student_id : undefined,
      studentIds: visible,
    })
    if (records.length === 0) {
      set.status = 200
      return { sent: null, records: 0, error: 'no_records' }
    }

    const owner = await getUserByAuth0Id(auth0Id)
    // RAW again — the template escapes these for its HTML and keeps them verbatim
    // for its subject and text body.
    const teamName =
      `${owner?.nickname || owner?.name || 'Your'} Team`.replace(/\.\s*$/, '') + "'s Team"
    const periodLabel =
      [from ? `from ${from}` : '', to ? `to ${to}` : ''].filter(Boolean).join(' ') || 'all time'

    // The ONE place escaping legitimately stays at the caller: this is genuinely
    // HTML being built here (a `<tbody>`'s worth of `<tr>`s), so each cell is
    // escaped as it is assembled and `attendanceEmail` inserts the result as
    // markup. A blanket "escape every argument" in the template would show the
    // coach a page of visible angle brackets.
    const rowsHtml = records
      .map(
        (r) => `
        <tr>
          <td style="padding:7px 10px;border-bottom:1px solid #e8e0d5;">${escapeHtml(r.full_name ?? 'Unknown')}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e8e0d5;color:${statusColor(r.status)};font-weight:600;text-transform:capitalize;">${escapeHtml(r.status)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e8e0d5;">${escapeHtml(r.session_date)}</td>
        </tr>`,
      )
      .join('')

    const present = records.filter((r) => r.status === 'present').length

    // Resolve recipient: explicit, or student email, else a chosen student, else coach.
    let address = typeof recipient === 'string' ? recipient.trim() : ''
    if (!address) {
      if (typeof student_id === 'string') {
        const student = await getStudent(auth0Id, student_id)
        address = student?.email ?? ''
      }
      if (!address && owner?.email) address = owner.email
    }
    if (!isDeliverableAddress(address)) {
      set.status = 400
      return buildError('INVALID_REQUEST', 'No valid recipient for this attendance sheet.', false)
    }

    try {
      const { subject, html, text } = attendanceEmail(
        teamName,
        periodLabel,
        rowsHtml,
        present,
        records.length,
      )
      const sent = await sendEmail({ to: address, subject, html, text })
      set.status = 200
      return { sent, records: records.length }
    } catch (err) {
      logger.error('email_attendance_failed', {
        type: 'email_attendance_failed',
        error: err instanceof Error ? err.message : String(err),
      })
      set.status = 502
      return buildError('EMAIL_SEND_FAILED', 'Attendance sheet could not be emailed.', true)
    }
  })
