import { Elysia } from "elysia"
import {
  upsertUser,
  getUserByAuth0Id,
  resolveAuth0Id,
  getUserAnalyses,
  getUserAnalysisById,
  getUserStats,
  updateAnalysisDisplayName,
  saveChatMessage,
  getChatMessages,
} from "../lib/supabaseHistory"
import { buildError } from "../lib/errors"
import { serviceGuard } from "../lib/serviceGuard"

function generateSimpleResponse(question: string, summary: Record<string, unknown> | null): string {
  if (!summary) {
    return "I don't have the analysis details available. Please try again later."
  }

  const q = question.toLowerCase()

  if (q.includes("score") || q.includes("rating")) {
    return `Based on the analysis, the form score is ${summary.form_score ?? "N/A"}/10 with an overall rating of "${summary.overall_rating ?? "N/A"}". ${summary.summary || ""}`
  }
  if (q.includes("tip") || q.includes("improve") || q.includes("focus")) {
    const tips = summary.top_tips as string[] | undefined
    return tips?.length
      ? `Here are the key areas to focus on:\n${tips.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "Focus on the fundamentals shown in the analysis summary."
  }
  if (q.includes("strength") || q.includes("good")) {
    const strengths = summary.strengths as string[] | undefined
    return strengths?.length
      ? `Your strengths from this session:\n${strengths.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "The analysis didn't highlight specific strengths."
  }
  if (q.includes("drill") || q.includes("practice")) {
    return summary.priority_drill
      ? `Recommended drill: ${summary.priority_drill}`
      : "No specific drill recommended for this session."
  }
  if (q.includes("event") || q.includes("shot")) {
    const events = summary.shot_events as Array<Record<string, unknown>> | undefined
    if (events?.length) {
      return `There were ${events.length} events detected. Here's a summary:\n${events.map((e, i) => `${i + 1}. ${e.timestamp}s - ${e.event_type}: Score ${e.form_score}/10`).join("\n")}`
    }
    return `The analysis detected ${summary.total_events ?? 0} events.`
  }

  return `${summary.summary || "Here's a summary of the analysis."} The form score was ${summary.form_score ?? "N/A"}/10. Feel free to ask about specific events, tips, strengths, or drills.`
}

export default new Elysia()
  .use(serviceGuard)
  .post("/api/auth/sync", async ({ body, set }) => {
    const { sub, email, name, nickname, picture, email_verified } = body as {
      sub: string
      email?: string
      name?: string
      nickname?: string
      picture?: string
      email_verified?: boolean
    }

    if (!sub) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required field: sub", false)
    }

    const user = await upsertUser({
      sub,
      email,
      name,
      nickname,
      picture,
      email_verified,
    })

    if (!user) {
      set.status = 500
      return buildError("INTERNAL_ERROR", "Failed to sync user", true)
    }

    // Resolve to primary auth0_id in case this is a linked account
    const primaryAuth0Id = await resolveAuth0Id(sub)

    set.status = 200
    return { user: { ...user, auth0_id: primaryAuth0Id } }
  })
  .get("/api/auth/user/:auth0Id", async ({ params, set }) => {
    const { auth0Id } = params

    if (!auth0Id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
    }

    const user = await getUserByAuth0Id(auth0Id)

    if (!user) {
      set.status = 404
      return buildError("NOT_FOUND", "User not found", false)
    }

    set.status = 200
    return { user }
  })
  .get("/api/auth/user/:auth0Id/analyses", async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
    }

    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100)
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0)
    const unlinked = url.searchParams.get("unlinked") === "1"

    const analyses = await getUserAnalyses(auth0Id, limit, offset, { unlinked })
    set.status = 200
    return { analyses }
  })
  .get("/api/auth/user/:auth0Id/analyses/:jobId", async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }

    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return buildError("NOT_FOUND", "Analysis not found", false)
    }

    set.status = 200
    return { analysis }
  })
  .get("/api/auth/user/:auth0Id/stats", async ({ params, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing auth0Id parameter", false)
    }

    const stats = await getUserStats(auth0Id)
    set.status = 200
    return { stats }
  })
  .patch("/api/auth/user/:auth0Id/analyses/:jobId", async ({ params, body, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }

    const { display_name } = body as { display_name?: string }
    if (display_name !== undefined && typeof display_name !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "display_name must be a string", false)
    }

    if (display_name !== undefined) {
      const analysis = await updateAnalysisDisplayName(auth0Id, jobId, display_name)
      if (!analysis) {
        set.status = 404
        return buildError("NOT_FOUND", "Analysis not found", false)
      }
      set.status = 200
      return { analysis }
    }

    const existing = await getUserAnalysisById(auth0Id, jobId)
    if (!existing) {
      set.status = 404
      return buildError("NOT_FOUND", "Analysis not found", false)
    }
    set.status = 200
    return { analysis: existing }
  })
  .get("/api/auth/user/:auth0Id/analyses/:jobId/chat", async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }

    const messages = await getChatMessages(jobId, auth0Id)
    const converted = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp_refs: m.timestamp_refs ?? undefined,
      event_refs: m.event_refs ?? undefined,
      created_at: typeof m.created_at === "string" ? new Date(m.created_at).getTime() / 1000 : m.created_at,
    }))
    set.status = 200
    return { messages: converted }
  })
  .post("/api/auth/user/:auth0Id/analyses/:jobId/chat", async ({ params, body, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing required parameters", false)
    }

    const { message } = body as { message?: string }
    if (!message || typeof message !== "string") {
      set.status = 400
      return buildError("INVALID_REQUEST", "Missing message", false)
    }

    await saveChatMessage({
      serverJobId: jobId,
      auth0Id,
      role: "user",
      content: message,
    })

    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return buildError("NOT_FOUND", "Analysis not found", false)
    }

    const summary = analysis.summary_json as Record<string, unknown> | null
    const contextParts: string[] = []
    if (summary) {
      if (summary.sport) contextParts.push(`Sport: ${summary.sport}`)
      if (summary.form_score) contextParts.push(`Form Score: ${summary.form_score}/10`)
      if (summary.overall_rating) contextParts.push(`Rating: ${summary.overall_rating}`)
      if (summary.summary) contextParts.push(`Summary: ${summary.summary}`)
      if (summary.top_tips && Array.isArray(summary.top_tips)) {
        contextParts.push(`Top Tips: ${summary.top_tips.join("; ")}`)
      }
      if (summary.strengths && Array.isArray(summary.strengths)) {
        contextParts.push(`Strengths: ${summary.strengths.join("; ")}`)
      }
      if (summary.priority_drill) contextParts.push(`Priority Drill: ${summary.priority_drill}`)
      if (summary.shot_events && Array.isArray(summary.shot_events)) {
        const events = summary.shot_events as Array<Record<string, unknown>>
        contextParts.push(`Shot Events (${events.length}):`)
        events.forEach((e, i) => {
          contextParts.push(`  ${i + 1}. ${e.timestamp}s - ${e.event_type}: Score ${e.form_score}/10. ${e.feedback || ""}`)
        })
      }
    }

    const systemPrompt = `You are a sports analysis AI assistant. You have previously analyzed a video and here is the analysis context:\n\n${contextParts.join("\n")}\n\nAnswer questions about this analysis. Be helpful, specific, and reference timestamps when relevant. Keep responses concise.`

    const history = await getChatMessages(jobId, auth0Id)
    const conversationHistory = history.map(m => ({
      role: m.role,
      content: m.content,
    }))

    let assistantMessage = ""
    try {
      const { ENGINE_URL, engineServiceHeaders } = await import("../lib/engine")
      const engineRes = await fetch(`${ENGINE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...engineServiceHeaders() },
        body: JSON.stringify({
          job_id: analysis.engine_job_id,
          message,
          conversation_history: conversationHistory,
          system_prompt: systemPrompt,
        }),
        signal: AbortSignal.timeout(30000),
      })

      if (engineRes.ok) {
        const data = await engineRes.json() as { reply?: string; message?: string }
        assistantMessage = data.reply || data.message || ""
      }
    } catch {
      assistantMessage = generateSimpleResponse(message, summary)
    }

    if (!assistantMessage) {
      assistantMessage = generateSimpleResponse(message, summary)
    }

    await saveChatMessage({
      serverJobId: jobId,
      auth0Id,
      role: "assistant",
      content: assistantMessage,
    })

    set.status = 200
    return {
      message: assistantMessage,
      role: "assistant",
    }
  })
