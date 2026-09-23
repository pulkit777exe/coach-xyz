import { getOrgOverview, searchOrg } from '../../lib/orgData'
import { serviceGuard } from '../../lib/serviceGuard'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Overview ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/overview', async ({ params, set }) => {
    const { auth0Id } = params
    const overview = await getOrgOverview(auth0Id)
    set.status = 200
    return { overview }
  })
  // ── Global search (students, schedule, reports, analyses) ──────────────────
  .get('/api/org/:auth0Id/search', async ({ params, request, set }) => {
    const { auth0Id } = params
    const url = new URL(request.url)
    const query = url.searchParams.get('q') ?? ''
    const results = await searchOrg(auth0Id, query)
    set.status = 200
    return results
  })
