import { getOrgOverview, searchOrg } from '../../lib/orgReports'
import { serviceGuard } from '../../lib/serviceGuard'
import { authorizeOrg } from '../../lib/orgRoute'
import { Elysia } from 'elysia'

export default new Elysia()
  .use(serviceGuard)
  // ── Overview ───────────────────────────────────────────────────────────────
  .get('/api/org/:auth0Id/overview', async ({ params, request, set }) => {
    const { auth0Id } = params
    const auth = await authorizeOrg(request, auth0Id, 'player.read')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
    const overview = await getOrgOverview(auth0Id)
    set.status = 200
    return { overview }
  })
  // ── Global search (students, schedule, reports, analyses) ──────────────────
  .get('/api/org/:auth0Id/search', async ({ params, request, set }) => {
    const { auth0Id } = params
    const auth = await authorizeOrg(request, auth0Id, 'player.read')
    if (!auth.ok) {
      set.status = auth.status
      return auth.body
    }
    const url = new URL(request.url)
    const query = url.searchParams.get('q') ?? ''
    const results = await searchOrg(auth0Id, query)
    set.status = 200
    return results
  })
