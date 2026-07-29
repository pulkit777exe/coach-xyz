import { Elysia } from "elysia"

import { getDownloadStream } from "../lib/engine"
import { buildError, isCoachAIError } from "../lib/errors"
import { getJob } from "../lib/jobs"
import { markAnalysisDownloaded } from "../lib/supabaseHistory"

export default new Elysia().get("/api/download/:jobId", async ({ params, set }) => {
  const serverJob = await getJob(params.jobId)

  if (!serverJob) {
    set.status = 404
    return buildError("JOB_NOT_FOUND", "Analysis session not found.", false)
  }

  try {
    const engineResponse = await getDownloadStream(serverJob.engine_job_id)
    const response = new Response(engineResponse.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="coachai_analysis.mp4"',
      },
    })
    // Increment download count after successful stream creation
    await markAnalysisDownloaded(serverJob.server_job_id)
    return response
  } catch (error) {
    if (isCoachAIError(error)) {
      if (error.code === "JOB_NOT_FOUND") {
        set.status = 404
        return buildError("JOB_NOT_FOUND", "Analysis not complete or video not available.", false)
      }
      if (error.code === "VIDEO_EXPIRED") {
        set.status = 404
        return buildError("VIDEO_EXPIRED", "This video is no longer available. The server may have restarted. Please upload your video again.", false)
      }
      if (error.code === "ENGINE_UNAVAILABLE") {
        set.status = 503
        return buildError("ENGINE_UNAVAILABLE", "Analysis engine is temporarily unavailable.", true)
      }
    }

    const routeError = error as { code?: string; message?: string }
    set.status = 503
    return buildError("ENGINE_UNAVAILABLE", routeError?.message ?? "Failed to download video.", true)
  }
})
