import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { emailConfigured, sendEmail, inviteEmail, reportEmail, attendanceEmail, escapeHtml } from "../lib/mailer"
import { getUserByAuth0Id } from "../lib/supabaseHistory"
import { listStudents, getStudent, getReport, listAttendance } from "../lib/orgData"
import { SERVICE_HEADERS, serviceGuard } from "../lib/serviceGuard"

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000"

// Resend onboarding domain is forced for unverified accounts; the app domain
// is used once a domain is verified in the dashboard.
const fromDomain = process.env.RESEND_FROM_DOMAIN ?? "onboarding@resend.dev"

const statusColor = (status: string): string => {
  switch (status) {
    case "present": return "#046C0C"
    case "late": return "#c49a2b"
    case "absent": return "#CC5728"
    default: return "#7a6e62"
  }
}

export default new Elysia()
  .use(serviceGuard)
  // ── Invite players by email ────────────────────────────────────────────
  // body: { emails: string[], student_ids?: string[] }
  // Creates missing student rows (arm-band email only, no account link),
  // then emails each address an invitation with a signup link.
  .post("/api/email/:auth0Id/invite", async ({ params, body, request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified || verified !== params.auth0Id) {
      set.status = 403
      return buildError("FORBIDDEN", "Authenticated identity does not match the requested account.", false)
    }

    const auth0Id = params.auth0Id as string
    const { emails, student_ids } = body as { emails?: unknown; student_ids?: unknown }

    if (!Array.isArray(emails) || emails.length === 0) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Provide at least one email address.", false)
    }
    const addresses = emails
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    if (addresses.length === 0) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Provide at least one valid email address.", false)
    }

    const owner = await getUserByAuth0Id(auth0Id)
    const coachName = owner?.name ?? "Your coach"
    const teamName = `${owner?.nickname || owner?.name || "Your"} Team`.replace(/\.\s*$/, "") + "'s Team"

    if (!emailConfigured()) {
      set.status = 501
      return buildError("EMAIL_NOT_CONFIGURED", "Email sending is not configured (missing RESEND_API_KEY).", false)
    }

    // Optional student linking: map emails → students so invites can be tracked.
    const linkMap = new Map<string, string>()
    if (Array.isArray(student_ids)) {
      const students = await listStudents(auth0Id, {})
      for (const sid of student_ids) {
        if (typeof sid !== "string") continue
        const student = students.find((s) => s.id === sid)
        if (student?.email) linkMap.set(student.email.toLowerCase(), student.id)
      }
    }

    const from = `${process.env.RESEND_FROM_NAME ?? "CoachXYZ"} <${fromDomain}>`
    const inviteUrl = `${FRONTEND_URL}/signup`

    const sent: { to: string; ok: boolean }[] = []
    for (const email of addresses) {
      try {
        const { subject, html, text } = inviteEmail(coachName, teamName, inviteUrl)
        await sendEmail({ to: email, subject, html, text })
        sent.push({ to: email, ok: true })
      } catch (err) {
        sent.push({ to: email, ok: false })
        console.error(JSON.stringify({
          type: "email_invite_failed",
          to: email,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    }

    const okCount = sent.filter((s) => s.ok).length
    if (okCount === 0) {
      set.status = 502
      return buildError("EMAIL_SEND_FAILED", "Invites could not be sent. Check the configured domain and key.", true)
    }
    set.status = 200
    return { sent, total: sent.length, failed: sent.length - okCount }
  })

  // ── Email a report to a recipient ───────────────────────────────────────
  // body: { report_id: string, to?: string }  — `to` defaults to the student's email
  .post("/api/email/:auth0Id/report", async ({ params, body, request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified || verified !== params.auth0Id) {
      set.status = 403
      return buildError("FORBIDDEN", "Authenticated identity does not match the requested account.", false)
    }

    const auth0Id = params.auth0Id as string
    const { report_id, to } = body as { report_id?: unknown; to?: unknown }

    if (typeof report_id !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "Provide a report_id.", false)
    }
    if (!emailConfigured()) {
      set.status = 501
      return buildError("EMAIL_NOT_CONFIGURED", "Email sending is not configured (missing RESEND_API_KEY).", false)
    }

    const report = await getReport(auth0Id, report_id)
    if (!report) {
      set.status = 404
      return buildError("NOT_FOUND", "Report not found.", false)
    }

    let recipient = typeof to === "string" ? to.trim() : ""
    let studentName = "Athlete"
    if (report.student_id) {
      const student = await getStudent(auth0Id, report.student_id)
      if (student) {
        studentName = student.full_name
        if (!recipient && student.email) recipient = student.email
      }
    }
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "No valid recipient for this report (student has no email and no `to` given).", false)
    }

    const content = (report.content_json ?? {}) as { summary?: string | null }
    const summary = content.summary
      ? escapeHtml(content.summary).slice(0, 600)
      : "Open the report to view the full breakdown."

    const reportUrl = `${FRONTEND_URL}/dashboard/reports/${report_id}`
    try {
      const { subject, html, text } = reportEmail(studentName, report.title, summary, reportUrl)
      const sent = await sendEmail({ to: recipient, subject, html, text })
      set.status = 200
      return { sent }
    } catch (err) {
      console.error(JSON.stringify({
        type: "email_report_failed",
        report_id,
        error: err instanceof Error ? err.message : String(err),
      }))
      set.status = 502
      return buildError("EMAIL_SEND_FAILED", "Report could not be emailed.", true)
    }
  })

  // ── Email an attendance sheet ───────────────────────────────────────────
  // body: { student_id?: string, from?: string, to?: string, to?: string }
  .post("/api/email/:auth0Id/attendance", async ({ params, body, request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified || verified !== params.auth0Id) {
      set.status = 403
      return buildError("FORBIDDEN", "Authenticated identity does not match the requested account.", false)
    }

    const auth0Id = params.auth0Id as string
    const { student_id, from, to, recipient } = body as { student_id?: unknown; from?: unknown; to?: unknown; recipient?: unknown }
    if (!emailConfigured()) {
      set.status = 501
      return buildError("EMAIL_NOT_CONFIGURED", "Email sending is not configured (missing RESEND_API_KEY).", false)
    }

    if (student_id !== undefined && student_id !== null && typeof student_id !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "student_id must be a string.", false)
    }

    const records = await listAttendance(auth0Id, {
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      studentId: typeof student_id === "string" ? student_id : undefined,
    })
    if (records.length === 0) {
      set.status = 200
      return { sent: null, records: 0, error: "no_records" }
    }

    const owner = await getUserByAuth0Id(auth0Id)
    const teamName = `${owner?.nickname || owner?.name || "Your"} Team`.replace(/\.\s*$/, "") + "'s Team"
    const periodLabel = [from ? `from ${from}` : "", to ? `to ${to}` : ""].filter(Boolean).join(" ") || "all time"

    const rowsHtml = records
      .map(
        (r) => `
        <tr>
          <td style="padding:7px 10px;border-bottom:1px solid #e8e0d5;">${escapeHtml(r.full_name ?? "Unknown")}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e8e0d5;color:${statusColor(r.status)};font-weight:600;text-transform:capitalize;">${escapeHtml(r.status)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e8e0d5;">${escapeHtml(r.session_date)}</td>
        </tr>`,
      )
      .join("")

    const present = records.filter((r) => r.status === "present").length

    // Resolve recipient: explicit, or student email, else a chosen student, else coach.
    let address = typeof recipient === "string" ? recipient.trim() : ""
    if (!address) {
      if (typeof student_id === "string") {
        const student = await getStudent(auth0Id, student_id)
        address = student?.email ?? ""
      }
      if (!address && owner?.email) address = owner.email
    }
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      set.status = 400
      return buildError("INVALID_REQUEST", "No valid recipient for this attendance sheet.", false)
    }

    try {
      const { subject, html, text } = attendanceEmail(teamName, periodLabel, rowsHtml, present, records.length)
      const sent = await sendEmail({ to: address, subject, html, text })
      set.status = 200
      return { sent, records: records.length }
    } catch (err) {
      console.error(JSON.stringify({
        type: "email_attendance_failed",
        error: err instanceof Error ? err.message : String(err),
      }))
      set.status = 502
      return buildError("EMAIL_SEND_FAILED", "Attendance sheet could not be emailed.", true)
    }
  })