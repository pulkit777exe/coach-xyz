import type { CoachAIError, ScanResult } from "../types"
import type { EngineJobStatus } from "./jobs"

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8001"

function engineError(code: string, message: string, retryable = true): CoachAIError {
  return { code, message, layer: "engine", retryable }
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
  const body = (await res.json().catch(() => ({}))) as Partial<CoachAIError>
  throw engineError(
    body.code ?? "UNKNOWN",
    body.message ?? "Something went wrong.",
    body.retryable ?? true,
  )
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
    }, 180_000)

    if (!res.ok) {
      await throwNonOk(res)
    }

    return (await res.json()) as ScanResult
  } catch (error) {
    if (isConnectivityError(error)) {
      throw engineError("ENGINE_UNAVAILABLE", "Analysis engine is temporarily unavailable.")
    }

    throw error
  }
}

export const getDownloadStream = async (engineJobId: string): Promise<Response> => {
  try {
    const res = await withTimeout(`${ENGINE_URL}/download/${engineJobId}`, {
      method: "GET",
    }, 60_000)

    if (!res.ok) {
      throw engineError("JOB_NOT_FOUND", "Job not found or expired.")
    }

    return res
  } catch (error) {
    if (isConnectivityError(error)) {
      throw engineError("ENGINE_UNAVAILABLE", "Analysis engine is temporarily unavailable.")
    }

    throw error
  }
}

export type EngineStatusResult =
  | { status: "found"; data: EngineJobStatus }
  | { status: "not_found" }
  | { status: "transient_error" }

export const getEngineJobStatus = async (engineJobId: string): Promise<EngineStatusResult> => {
  try {
    const res = await withTimeout(`${ENGINE_URL}/status/${engineJobId}`, {
      method: "GET",
    }, 5_000)

    if (!res.ok) {
      if (res.status === 404) return { status: "not_found" }
      await throwNonOk(res)
    }

    return { status: "found", data: (await res.json()) as EngineJobStatus }
  } catch (error) {
    if (isConnectivityError(error)) {
      return { status: "transient_error" }
    }
    throw error
  }
}

export const markEngineJobFailed = async (
  engineJobId: string,
  message: string,
  code: string,
  retryable: boolean,
): Promise<void> => {
  try {
    const res = await withTimeout(`${ENGINE_URL}/fail/${engineJobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, code, retryable }),
    }, 5_000)

    if (!res.ok && res.status !== 404) {
      await throwNonOk(res)
    }
  } catch (error) {
    if (isConnectivityError(error)) {
      return
    }
    throw error
  }
}
