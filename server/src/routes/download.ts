import { Elysia } from "elysia"

import { getDownloadStream } from "../lib/engine"
import { buildError } from "../lib/errors"
import { getJob } from "../lib/jobs"
import { markAnalysisDownloaded } from "../lib/supabaseHistory"

export default new Elysia().get("/api/download/:jobId", async ({ params, set }) => {
  const serverJob = await getJob(params.jobId)

  if (!serverJob) {
    set.status = 404
    return buildError("JOB_NOT_FOUND", undefined, false)
  }

  try {
    const engineResponse = await getDownloadStream(serverJob.engine_job_id)
    await markAnalysisDownloaded(serverJob.server_job_id)
    return new Response(engineResponse.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="coachai_analysis.mp4"',
      },
    })
  } catch (error) {
    const routeError = error as any

    if (routeError?.code === "JOB_NOT_FOUND") {
      set.status = 404
      return buildError("JOB_NOT_FOUND", undefined, false)
    }

    set.status = 503
    return buildError("ENGINE_UNAVAILABLE", routeError?.message)
  }
})
