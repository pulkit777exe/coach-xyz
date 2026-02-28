import { Elysia } from "elysia"

import { getDownloadStream } from "../lib/engine"
import { buildError } from "../lib/errors"
import { getJob } from "../lib/jobs"

type EngineRouteError = {
  code?: string
  message?: string
}

export default new Elysia().get("/api/download/:jobId", async ({ params, set }) => {
  const job = getJob(params.jobId)

  if (!job) {
    set.status = 404
    return buildError("JOB_NOT_FOUND")
  }

  try {
    const engineResponse = await getDownloadStream(job.engine_job_id)
    return new Response(engineResponse.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="coachai_analysis.mp4"',
      },
    })
  } catch (error) {
    const routeError = error as EngineRouteError

    if (routeError.code === "JOB_NOT_FOUND") {
      set.status = 404
      return buildError("JOB_NOT_FOUND")
    }

    set.status = 503
    return buildError("ENGINE_UNAVAILABLE", routeError.message)
  }
})
