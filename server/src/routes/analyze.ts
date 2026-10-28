import { Elysia } from 'elysia'

import { admitAnalysis } from '../lib/admission'
import { buildError } from '../lib/errors'

export default new Elysia().post('/api/analyze-video', async ({ request, set, body }) => {
  // Admission (rate → validate → quota → tier → persist → enqueue → usage)
  // lives in lib/admission; this route maps outcomes to HTTP.
  try {
    const outcome = await admitAnalysis({ request, body: body as Parameters<typeof admitAnalysis>[0]['body'] })
    if (!outcome.ok) {
      set.status = outcome.status
      return outcome.body
    }
    set.status = 200
    return { job_id: outcome.serverJobId }
  } catch (error) {
    if (error instanceof Error && error.message === 'QUEUE_UNAVAILABLE') {
      set.status = 503
      return buildError('QUEUE_UNAVAILABLE', 'Job queue is not configured.', true)
    }
    console.error(
      JSON.stringify({
        type: 'analyze_enqueue_error',
        message: (error as Error)?.message,
        stack: (error as Error)?.stack,
        timestamp: new Date().toISOString(),
      }),
    )
    set.status = 500
    return buildError('INTERNAL_ERROR', 'Failed to enqueue analysis job. Please try again.', true)
  }
})
