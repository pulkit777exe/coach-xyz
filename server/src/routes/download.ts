import { Elysia } from 'elysia'

import { getDownloadStream, requestIdFrom } from '../lib/engine'
import { buildError, enginePassthroughStatus, errorBody, isCoachAIError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import type { ServerJob } from '../lib/jobs'
import { resolveJobCaller, verifyJobAccess } from '../lib/jobAccess'
import { checkDownloadLimit, getIP, rateLimited } from '../lib/ratelimit'
import { markAnalysisDownloaded, getAnalysisByServerJobId } from '../lib/analyses'
import { auditRoute } from '../lib/audit'
import { logger } from '../lib/logger'

/** Everything this route needs, so tests can stub the job store. */
export type DownloadRouteDeps = {
  getJob?: (jobId: string) => Promise<ServerJob | null>
  getAnalysisByServerJobId?: typeof getAnalysisByServerJobId
}

export const downloadRoute = (deps: DownloadRouteDeps = {}) =>
  new Elysia().get('/api/download/:jobId', async ({ params, request, set }) => {
    const serverJob = await (deps.getJob ?? getJob)(params.jobId)
    // Redis mapping expired — fall back to the persisted row, mirroring
    // status: a 2h TTL must not brick downloads of finished analyses.
    const persisted = serverJob
      ? null
      : await (deps.getAnalysisByServerJobId ?? getAnalysisByServerJobId)(params.jobId)

    // Either mapping serves: narrows non-null for the engine id,
    // download count, and audit below.
    const source = serverJob ?? persisted
    if (!source) {
      set.status = 404
      return buildError('JOB_NOT_FOUND', 'Analysis session not found.', false)
    }

    const access = verifyJobAccess(request, serverJob, persisted)
    if (!access.ok) {
      set.status = access.status
      return access.body
    }

    const { allowed, reset } = await checkDownloadLimit(resolveJobCaller(request) ?? getIP(request))
    if (!allowed) {
      return rateLimited(
        set,
        'Too many download requests. Try again later.',
        Math.ceil((reset - Date.now()) / 1000),
      )
    }

    try {
      const engineResponse = await getDownloadStream(
        source.engine_job_id,
        requestIdFrom(request),
      )
      const contentType = engineResponse.headers?.get('content-type') ?? 'video/mp4'
      const contentLength = engineResponse.headers?.get('content-length')
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Disposition': 'inline; filename="coachai_analysis.mp4"',
        'Accept-Ranges': 'bytes',
        // Owner-gated bytes: never `public` — a shared cache keyed on
        // URL alone could serve one job's video for another's request.
        'Cache-Control': 'private, max-age=3600',
      }
      if (contentLength) {
        headers['Content-Length'] = contentLength
      }
      const response = new Response(engineResponse.body, { headers })
      // Increment download count after successful stream creation
      await markAnalysisDownloaded(source.server_job_id)
      // Video export is a sensitive action (§29) — audit the verified caller
      // against the owning org (persisted row already fetched above: no
      // second lookup).
      auditRoute(
        request,
        persisted?.auth0_id ?? 'unknown',
        'video.exported',
        'analysis',
        source.server_job_id,
        null,
        resolveJobCaller(request),
      )
      return response
    } catch (error) {
      // The ENGINE owns code → status/message here (jobs.py /download answers
      // JOB_NOT_FOUND / VIDEO_NOT_FOUND / VIDEO_EXPIRED canonically); pass the
      // stamped status through. Statusless ENGINE_UNAVAILABLE (connectivity
      // loss) keeps this route's historical 503.
      if (isCoachAIError(error)) {
        set.status = enginePassthroughStatus(error, 503)
        return errorBody(error)
      }

      const routeError = error as { code?: string; message?: string }
      logger.error('download_error', {
        type: 'download_error',
        code: routeError?.code ?? 'UNKNOWN',
        error: routeError?.message ?? 'unknown',
      })
      set.status = 503
      return buildError('ENGINE_UNAVAILABLE', 'Could not download video. Please try again.', true)
    }
  })

export default downloadRoute()
