import { Elysia } from 'elysia'

import { resolveJobStatus } from '../lib/jobStatus'

export default new Elysia().get('/api/job-status/:jobId', async ({ params, request, set }) => {
  const outcome = await resolveJobStatus(params.jobId, request)
  set.status = outcome.status
  return outcome.body
})
