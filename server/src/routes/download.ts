import { Elysia } from 'elysia'

import { getDownloadStream, requestIdFrom } from '../lib/engine'
import { buildError, isCoachAIError } from '../lib/errors'
import { getJob } from '../lib/jobs'
import { resolveJobCaller, verifyJobAccess } from '../lib/jobAccess'
import { checkDownloadLimit, getIP } from '../lib/ratelimit'
import { markAnalysisDownloaded } from '../lib/supabaseHistory'

export default new Elysia().get('/api/download/:jobId', async ({ params, request, set }) => {
  const serverJob = await getJob(params.jobId)

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
    const retryAfter = Math.ceil((reset - Date.now()) / 1000)
    set.status = 429
    return {
      ...buildError('RATE_LIMITED', 'Too many download requests. Try again later.', true),
      retry_after: retryAfter,
    }
  }

  try {
    const engineResponse = await getDownloadStream(serverJob.engine_job_id, requestIdFrom(request))
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
    return response
  } catch (error) {
    if (isCoachAIError(error)) {
      if (error.code === 'JOB_NOT_FOUND') {
        set.status = 404
        return buildError('JOB_NOT_FOUND', 'Analysis not complete or video not available.', false)
      }
      if (error.code === 'VIDEO_EXPIRED') {
        set.status = 404
        return buildError(
          'VIDEO_EXPIRED',
          'This video is no longer available. The server may have restarted. Please upload your video again.',
          false,
        )
      }
      if (error.code === 'ENGINE_UNAVAILABLE') {
        set.status = 503
        return buildError('ENGINE_UNAVAILABLE', 'Analysis engine is temporarily unavailable.', true)
      }
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
