import { Elysia } from 'elysia'

import { buildError } from '../lib/errors'
import { resolveJobStatus } from '../lib/jobStatus'
import { checkLimit, getIP } from '../lib/ratelimit'

/** Per-IP per-minute cap on status polls: each poll can fan out to an
 *  engine request plus a DB persist, so a tight loop is a DDoS amplifier.
 *  Default 120/min allows several tabs polling every 2s. */
const JOB_STATUS_LIMIT = parseInt(process.env.JOB_STATUS_RATE_LIMIT ?? '120', 10)

export const checkJobStatusRateLimit = async (request: Request): Promise<boolean> => {
  const { allowed } = await checkLimit({
    key: `rl:jobstatus:${getIP(request)}`,
    limit: JOB_STATUS_LIMIT,
    windowSec: 60,
  })
  return allowed
}

export default new Elysia().get('/api/job-status/:jobId', async ({ params, request, set }) => {
  if (!(await checkJobStatusRateLimit(request))) {
    set.status = 429
    return buildError('RATE_LIMITED', 'Too many status requests. Slow down and retry.', true)
  }
  const outcome = await resolveJobStatus(params.jobId, request)
  set.status = outcome.status
  return outcome.body
})
