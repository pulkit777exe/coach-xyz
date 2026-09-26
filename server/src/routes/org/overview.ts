import { getOrgOverview, searchOrg } from '../../lib/orgData'
import { resolveCaller } from '../../lib/caller'
import { visibleStudentIds } from '../../lib/org/scope'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

// Capability is not scope: the rollup and the search box are org-wide queries,
// so both resolve the caller once and hand the visible-student set down.
// Otherwise a team-A coach reads team B's headcount here and enumerates team B
// by name in /search. `null` (org-wide) and `[]` (sees nothing) stay distinct
// all the way into the data layer — an unassigned coach gets zeros and no hits.
export default new Elysia()
  .use(serviceGuard)
  // ── Overview ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/overview', async ({ params, request, set }) => {
    const { auth0Id } = params
    const caller = await resolveCaller(auth0Id, request)
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    // The calendar counts and the schedule arm of the search are team-keyed, not
    // student-keyed, so they need the team half of the scope as well.
    const teamIds = caller.studentScope.all ? undefined : caller.studentScope.teamIds
    const overview = await getOrgOverview(auth0Id, studentIds, teamIds)
    set.status = 200
    return { overview }
  })
  // ── Global search (students, schedule, reports, analyses) ──────────────────
  .get('/api/org/:auth0Id/search', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const query = url.searchParams.get('q') ?? ''
    const caller = await resolveCaller(auth0Id, request)
    const studentIds = await visibleStudentIds(auth0Id, caller.studentScope)
    const teamIds = caller.studentScope.all ? undefined : caller.studentScope.teamIds
    const results = await searchOrg(auth0Id, query, studentIds, teamIds)
    set.status = 200
    return results
  })
