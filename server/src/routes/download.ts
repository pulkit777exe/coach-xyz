import { Elysia } from 'elysia'

import { getDownloadStream, requestIdFrom } from '../lib/engine'
import { buildError, enginePassthroughStatus, errorBody, isCoachAIError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import type { ServerJob } from '../lib/jobs'
import { resolveJobCaller, verifyJobAccess } from '../lib/jobAccess'
import { checkDownloadLimit, getIP, rateLimited } from '../lib/ratelimit'
import { markAnalysisDownloaded, getAnalysisByServerJobId } from '../lib/analyses'
import { auditRoute } from '../lib/audit'

/** Everything this route needs, so tests can stub the job store. */
export type DownloadRouteDeps = {
  getJob?: (jobId: string) => Promise<ServerJob | null>
}

export const downloadRoute = (deps: DownloadRouteDeps = {}) =>
  new Elysia().get('/api/download/:jobId', async ({ params, request, set }) => {
    const serverJob = await (deps.getJob ?? getJob)(params.jobId)

    if (!serverJob) {
      set.status = 404
      return buildError('JOB_NOT_FOUND', 'Analysis session not found.', false)
    }

    const access = verifyJobAccess(request, serverJob)
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
        serverJob.engine_job_id,
        requestIdFrom(request),
      )
      const contentType = engineResponse.headers?.get('content-type') ?? 'video/mp4'
      const contentLength = engineResponse.headers?.get('content-length')
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Disposition': 'inline; filename="coachai_analysis.mp4"',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      }
      if (contentLength) {
        headers['Content-Length'] = contentLength
      }
      const response = new Response(engineResponse.body, { headers })
      // Increment download count after successful stream creation
      await markAnalysisDownloaded(serverJob.server_job_id)
      // Video export is a sensitive action (§29) — audit the verified caller
      // against the owning org.
      const persisted = await getAnalysisByServerJobId(serverJob.server_job_id).catch(() => null)
      auditRoute(
        request,
        persisted?.auth0_id ?? 'unknown',
        'video.exported',
        'analysis',
        serverJob.server_job_id,
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
      console.error(
        JSON.stringify({
          type: 'download_error',
          code: routeError?.code ?? 'UNKNOWN',
          message: routeError?.message ?? 'unknown',
          timestamp: new Date().toISOString(),
        }),
      )
      set.status = 503
      return buildError('ENGINE_UNAVAILABLE', 'Could not download video. Please try again.', true)
    }
  })

export default downloadRoute()
