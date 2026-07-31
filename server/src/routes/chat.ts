import { Elysia } from "elysia"

import { buildError } from "../lib/errors"
import { getJob } from "../lib/jobs"
import { getConversation, saveMessage } from "../lib/conversation"

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8001"

const withTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export default new Elysia()
  // Send a chat message and get AI reply
  .post("/api/chat", async ({ body, set }) => {
    const { job_id, message } = body as { job_id?: string; message?: string }

    if (!job_id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "job_id is required.", false)
    }
    if (!message?.trim()) {
      set.status = 400
      return buildError("INVALID_REQUEST", "message is required.", false)
    }

    // Look up server job to get engine_job_id
    const serverJob = await getJob(job_id)
    if (!serverJob) {
      set.status = 404
      return buildError("JOB_NOT_FOUND", "Analysis session not found.", false)
    }

    // Load conversation history (before saving user message)
    const history = await getConversation(job_id)
    const historyForEngine = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }))

    // Proxy to engine /chat
    try {
      const res = await withTimeout(`${ENGINE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: serverJob.engine_job_id,
          message: message.trim(),
          conversation_history: historyForEngine,
        }),
      }, 60_000)

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const code = (errBody.code as string) ?? "CHAT_FAILED"
        const msg = (errBody.message as string) ?? "AI service error."
        set.status = res.status >= 400 && res.status < 500 ? res.status : 502
        return buildError(code, msg, res.status >= 500)
      }

      const data = (await res.json()) as {
        reply: string
        timestamp_refs?: number[]
        event_refs?: number[]
      }

      // Save both user and assistant messages only after engine success
      // This prevents orphaned user messages when the engine fails
      await saveMessage(job_id, {
        role: "user",
        content: message.trim(),
      })
      await saveMessage(job_id, {
        role: "assistant",
        content: data.reply,
        timestamp_refs: data.timestamp_refs,
        event_refs: data.event_refs,
      })

      set.status = 200
      return {
        reply: data.reply,
        timestamp_refs: data.timestamp_refs ?? [],
        event_refs: data.event_refs ?? [],
      }
    } catch (error) {
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError"
      const isConnectivity =
        error instanceof TypeError ||
        isTimeout

      if (isConnectivity) {
        set.status = 502
        return buildError(
          "ENGINE_UNAVAILABLE",
          "Analysis engine is temporarily unavailable. Please try again.",
          true,
        )
      }

      console.error(JSON.stringify({
        type: "chat_proxy_error",
        message: error instanceof Error ? error.message : "unknown",
        timestamp: new Date().toISOString(),
      }))
      set.status = 500
      return buildError("INTERNAL_ERROR", "Chat service error.", true)
    }
  })
  // Load conversation history for a job
  .get("/api/conversation/:jobId", async ({ params, set }) => {
    const serverJob = await getJob(params.jobId)
    if (!serverJob) {
      set.status = 404
      return buildError("JOB_NOT_FOUND", "Analysis session not found.", false)
    }

    const messages = await getConversation(params.jobId)
    set.status = 200
    return { messages }
  })
