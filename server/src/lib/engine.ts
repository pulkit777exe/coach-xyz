import type { ErrorResponse, JobStatus, ScanResult } from "../types"

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8001"

type EngineError = {
  code: string
  message?: string
}

const withTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

const throwNonOk = async (res: Response): Promise<never> => {
  const body = (await res.json().catch(() => ({}))) as Partial<ErrorResponse>
  throw {
    code: body.error ?? "UNKNOWN",
    message: body.message,
  } satisfies EngineError
}

const isConnectivityError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === "AbortError")

export const scanVideo = async (videoFile: File): Promise<ScanResult> => {
  const form = new FormData()
  form.append("video", videoFile, videoFile.name || "video.mp4")

  try {
    const res = await withTimeout(`${ENGINE_URL}/scan`, {
      method: "POST",
      body: form,
    }, 60_000)

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as ScanResult
  } catch (error) {
    if (isConnectivityError(error)) {
      throw { code: "ENGINE_UNAVAILABLE" } satisfies EngineError
    }

    throw error
  }
}

export const startAnalysis = async (params: {
  session_token: string | null
  player_index: number | null
  model: string
}): Promise<{ job_id: string }> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/analyze`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
      30_000,
    )

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as { job_id: string }
  } catch (error) {
    if (isConnectivityError(error)) {
      throw { code: "ENGINE_UNAVAILABLE" } satisfies EngineError
    }

    throw error
  }
}

export const getJobStatus = async (engineJobId: string): Promise<JobStatus> => {
  try {
    const res = await withTimeout(`${ENGINE_URL}/status/${engineJobId}`, {
      method: "GET",
    }, 10_000)

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as JobStatus
  } catch (error) {
    if (isConnectivityError(error)) {
      throw { code: "ENGINE_UNAVAILABLE" } satisfies EngineError
    }

    throw error
  }
}

export const getDownloadStream = async (engineJobId: string): Promise<Response> => {
  try {
    const res = await fetch(`${ENGINE_URL}/download/${engineJobId}`, {
      method: "GET",
    })

    if (!res.ok) {
      throw { code: "JOB_NOT_FOUND" } satisfies EngineError
    }

    return res
  } catch (error) {
    if (isConnectivityError(error)) {
      throw { code: "ENGINE_UNAVAILABLE" } satisfies EngineError
    }

    throw error
  }
}
