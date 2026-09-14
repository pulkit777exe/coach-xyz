import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import {
  getUserByAuth0Id,
  resolveAuth0Id,
} from "../lib/supabaseHistory"
import {
  getLinkedPlayer,
  listAttendance,
  attendanceSummary,
  listSchedule,
  getStudentPerformanceSeries,
  getStudentAnalyses,
  listReports,
  getReport,
} from "../lib/orgData"
import { SERVICE_HEADERS, serviceGuard } from "../lib/serviceGuard"

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

export default new Elysia()
  .use(serviceGuard)

  // Own profile: user record + linked student (if any)
  .get("/api/me/profile", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }

    const { accountAuth0Id, student, coachAuth0Id } = await playerScope(verified)
    const user = await getUserByAuth0Id(accountAuth0Id)

    set.status = 200
    return { user, student, coach_auth0_id: coachAuth0Id }
  })

  // Own attendance history + summary (joined with the linked player scope)
  .get("/api/me/attendance", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { records: [], summary: null, linked: false }
    }

    const url = new URL(request.url)
    const from = url.searchParams.get("from") ?? undefined
    const to = url.searchParams.get("to") ?? undefined

    const [records, summary] = await Promise.all([
      listAttendance(coachAuth0Id, { from, to, studentId: student.id }),
      attendanceSummary(coachAuth0Id, { from, to, studentId: student.id }),
    ])

    set.status = 200
    return { records, summary, linked: true }
  })

  // Team schedule (all events for the owning coach's org)
  .get("/api/me/schedule", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const { coachAuth0Id } = await playerScope(verified)
    if (!coachAuth0Id) {
      set.status = 200
      return { events: [], linked: false }
    }

    const url = new URL(request.url)
    const from = url.searchParams.get("from") ?? undefined
    const to = url.searchParams.get("to") ?? undefined

    const events = await listSchedule(coachAuth0Id, { from, to })
    set.status = 200
    return { events, linked: true }
  })

  // Own performance trends (analysis form scores + any manual metrics)
  .get("/api/me/performance", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { points: [], linked: false }
    }

    const url = new URL(request.url)
    const from = url.searchParams.get("from") ?? undefined
    const to = url.searchParams.get("to") ?? undefined

    const points = await getStudentPerformanceSeries(coachAuth0Id, student.id, { from, to })
    set.status = 200
    return { points, linked: true }
  })

  // Own analyses (analysis_history rows linked to the player's student row)
  .get("/api/me/analyses", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { analyses: [], linked: false }
    }

    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100)

    const analyses = await getStudentAnalyses(coachAuth0Id, student.id, limit)
    set.status = 200
    return { analyses, linked: true }
  })

  // Reports that mention me (student-scoped)
  .get("/api/me/reports", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { reports: [], linked: false }
    }

    const reports = await listReports(coachAuth0Id, { studentId: student.id })
    set.status = 200
    return { reports, linked: true }
  })

  .get("/api/me/reports/:id", async ({ request, params, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const { student, coachAuth0Id } = await playerScope(verified)
    if (!student || !coachAuth0Id) {
      set.status = 200
      return { report: null, linked: false }
    }

    const report = await getReport(coachAuth0Id, params.id)
    if (!report || report.student_id !== student.id) {
      set.status = 404
      return buildError("NOT_FOUND", "Report not found", false)
    }

    set.status = 200
    return { report, linked: true }
  })