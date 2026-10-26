import { cache } from 'react'

import { getSession } from './session'
import { syncUser as apiSyncUser, type UserRecord } from './user'
import { resolveOrgContext, type OrgContext } from './orgContext'
import {
  getMyOrgs,
  getMyAnalyses as libGetMyAnalyses,
  getMyObjectives as libGetMyObjectives,
  getMyReports as libGetMyReports,
  getMyReport as libGetMyReport,
  getMySchedule as libGetMySchedule,
} from './meApi'
import { ORG_COOKIE } from './orgCookie'
import { getUserProfile as apiGetUserProfile } from './user'
import {
  getDashboardStats as apiGetDashboardStats,
  getDashboardAnalyses as apiGetDashboardAnalyses,
  getDashboardAnalysisDetail as apiGetDashboardAnalysisDetail,
} from './library'
import {
  orgOverview as libOrgOverview,
  orgSchedule as libOrgSchedule,
  orgReports as libOrgReports,
  orgReport as libOrgReport,
  orgStudents as libOrgStudents,
  orgStudentsSports as libOrgStudentsSports,
  orgAttendance as libOrgAttendance,
  orgStudent as libOrgStudent,
  orgStudentPerformance as libOrgStudentPerformance,
  orgAttendanceSummary as libOrgAttendanceSummary,
  orgStudentAnalyses as libOrgStudentAnalyses,
  orgSeasons as libOrgSeasons,
} from './org'
import { orgMembers as libOrgMembers } from './members'
import { orgSubscription as libOrgSubscription } from './org'
import { orgAuditLogs as libOrgAuditLogs, orgInvites as libOrgInvites } from './members'
import { listTeams as libListTeams } from './teams'

/**
 * Server-only data fetchers wrapped in React.cache() for per-request
 * deduplication. Layouts, generateMetadata, and page bodies commonly request
 * the same user/analysis data in a single render pass; the cache collapses
 * those into one network call. Import these from RSC pages — never from
 * client components (React.cache is server-only).
 */
export const getUserProfile = cache((auth0Id: string) => apiGetUserProfile(auth0Id))

export const getDashboardStats = cache((auth0Id: string) => apiGetDashboardStats(auth0Id))

export const getDashboardAnalyses = cache(
  (
    auth0Id: string,
    limit?: number,
    offset?: number,
    opts: Parameters<typeof apiGetDashboardAnalyses>[3] = {},
  ) => apiGetDashboardAnalyses(auth0Id, limit, offset, opts),
)

export const getDashboardAnalysisDetail = cache((auth0Id: string, jobId: string) =>
  apiGetDashboardAnalysisDetail(auth0Id, jobId),
)

export const orgOverview = cache((auth0Id: string) => libOrgOverview(auth0Id))

export const orgSchedule = cache(
  (auth0Id: string, opts: Parameters<typeof libOrgSchedule>[1] = {}) =>
    libOrgSchedule(auth0Id, opts),
)

export const orgReports = cache((auth0Id: string, opts: Parameters<typeof libOrgReports>[1] = {}) =>
  libOrgReports(auth0Id, opts),
)

export const orgReport = cache((auth0Id: string, id: string) => libOrgReport(auth0Id, id))

export const orgStudents = cache(
  (auth0Id: string, opts: Parameters<typeof libOrgStudents>[1] = {}) =>
    libOrgStudents(auth0Id, opts),
)

export const orgStudentsSports = cache((auth0Id: string) => libOrgStudentsSports(auth0Id))

export const orgAttendance = cache(
  (auth0Id: string, opts: Parameters<typeof libOrgAttendance>[1] = {}) =>
    libOrgAttendance(auth0Id, opts),
)

export const orgStudent = cache((auth0Id: string, id: string) => libOrgStudent(auth0Id, id))

export const orgStudentPerformance = cache((auth0Id: string, id: string) =>
  libOrgStudentPerformance(auth0Id, id),
)

export const orgAttendanceSummary = cache(
  (auth0Id: string, opts: Parameters<typeof libOrgAttendanceSummary>[1] = {}) =>
    libOrgAttendanceSummary(auth0Id, opts),
)

export const orgStudentAnalyses = cache((auth0Id: string, id: string) =>
  libOrgStudentAnalyses(auth0Id, id),
)

export const orgMembers = cache((auth0Id: string) => libOrgMembers(auth0Id))

export const orgSubscription = cache((auth0Id: string) => libOrgSubscription(auth0Id))

export const orgInvites = cache((auth0Id: string) => libOrgInvites(auth0Id))

export const orgAuditLogs = cache((auth0Id: string, limit = 50) => libOrgAuditLogs(auth0Id, limit))

export const orgTeams = cache((auth0Id: string) => libListTeams(auth0Id))

export const orgSeasons = cache((auth0Id: string) => libOrgSeasons(auth0Id))

export { ORG_COOKIE } from './orgCookie'
export type { OrgContext, OrgRole } from './orgContext'
export { resolveOrgContext } from './orgContext'

/** Per-request cached /api/me/orgs (used by both the switcher and getOrgContext). */
export const getMyOrgsCached = cache(() => getMyOrgs())

export const getMySchedule = cache(() => libGetMySchedule())

export const getMyAnalyses = cache(() => libGetMyAnalyses())

export const getMyReports = cache(() => libGetMyReports())

export const getMyReport = cache((id: string) => libGetMyReport(id))

export const getMyObjectives = cache(() => libGetMyObjectives())

/**
 * Resolves the CURRENT caller's org context (RSC only, session-aware and
 * per-request memoized). The session sub IS the org id for owners; invited
 * coaches carry a DIFFERENT sub, so every dashboard page must scope its org
 * fetchers to the resolved auth0Id — never `session.user.sub` directly.
 *
 * Honors the `coach_org` cookie when it names an org the caller belongs to
 * (switcher preference), otherwise falls back to owner-of-self / first
 * membership. Never regresses the single-coach flow.
 */
export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const session = await getSession()
  const ownSub = session?.user?.sub

  let preferred: string | null = null
  try {
    const mod = await import('next/headers')
    const store = await mod.cookies()
    preferred = store.get(ORG_COOKIE)?.value ?? null
  } catch {
    // Outside RSC (vitest / build) — no cookie store
  }

  try {
    const { orgs } = await getMyOrgsCached()
    return resolveOrgContext(ownSub, orgs, preferred)
  } catch {
    // membership lookup failed — fall through to owner-of-self
  }

  return resolveOrgContext(ownSub, [], preferred)
})

/**
 * Auth sync mutation for RSC pages. Deliberately NOT React.cache-wrapped:
 * mutations must never be deduped. Lives here (rather than a direct
 * `@/lib/user` import in pages) so the page layer has a single server import
 * surface — cached reads above, uncached writes below.
 */
export async function syncUser(user: {
  sub: string
  email?: string
  name?: string
  nickname?: string
  picture?: string
  email_verified?: boolean
}): Promise<{ user: UserRecord }> {
  return apiSyncUser(user)
}

