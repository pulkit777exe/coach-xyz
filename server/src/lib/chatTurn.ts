// ── Chat turn use-case interactor ────────────────────────────────────────────
// One public function per use case: answerChatTurn builds the analysis context,
// asks the engine for a reply, and falls back to keyword-matched summary text
// when the engine is unreachable or silent. The engine is reached ONLY through
// lib/engine.ts primitives (ENGINE_URL, engineServiceHeaders, withTimeout) —
// never a raw env read or bare fetch. History reads stay in the route.

import { ENGINE_URL, engineServiceHeaders, withTimeout } from './engine'

export type ChatHistoryMessage = {
  role: string
  content: string
}

export type ChatTurnInput = {
  message: string
  summary: Record<string, unknown> | null
  engineJobId: string
  conversationHistory: ChatHistoryMessage[]
}

export type EngineChatFn = (args: {
  engineJobId: string
  message: string
  conversationHistory: ChatHistoryMessage[]
  systemPrompt: string
}) => Promise<string | null>

/** Injectable seam for tests (fake engine, no live infra). */
export type ChatTurnDeps = {
  chatWithEngine?: EngineChatFn
}

const buildChatSystemPrompt = (summary: Record<string, unknown> | null): string => {
  const contextParts: string[] = []
  if (summary) {
    if (summary.sport) contextParts.push(`Sport: ${summary.sport}`)
    if (summary.form_score) contextParts.push(`Form Score: ${summary.form_score}/10`)
    if (summary.overall_rating) contextParts.push(`Rating: ${summary.overall_rating}`)
    if (summary.summary) contextParts.push(`Summary: ${summary.summary}`)
    if (summary.top_tips && Array.isArray(summary.top_tips)) {
      contextParts.push(`Top Tips: ${summary.top_tips.join('; ')}`)
    }
    if (summary.strengths && Array.isArray(summary.strengths)) {
      contextParts.push(`Strengths: ${summary.strengths.join('; ')}`)
    }
    if (summary.priority_drill) contextParts.push(`Priority Drill: ${summary.priority_drill}`)
    if (summary.shot_events && Array.isArray(summary.shot_events)) {
      const events = summary.shot_events as Array<Record<string, unknown>>
      contextParts.push(`Shot Events (${events.length}):`)
      events.forEach((e, i) => {
        contextParts.push(
          `  ${i + 1}. ${e.timestamp}s - ${e.event_type}: Score ${e.form_score}/10. ${e.feedback || ''}`,
        )
      })
    }
  }

  return `You are a sports analysis AI assistant. You have previously analyzed a video and here is the analysis context:\n\n${contextParts.join('\n')}\n\nAnswer questions about this analysis. Be helpful, specific, and reference timestamps when relevant. Keep responses concise.`
}

// Keyword fallback for when the engine is unreachable or returns nothing.
// Single source for the route-level generateSimpleResponse compatibility shim.
export const keywordFallback = (
  question: string,
  summary: Record<string, unknown> | null,
): string => {
  if (!summary) {
    return "I don't have the analysis details available. Please try again later."
  }

  const q = question.toLowerCase()

  if (q.includes('score') || q.includes('rating')) {
    return `Based on the analysis, the form score is ${summary.form_score ?? 'N/A'}/10 with an overall rating of "${summary.overall_rating ?? 'N/A'}". ${summary.summary || ''}`
  }
  if (q.includes('tip') || q.includes('improve') || q.includes('focus')) {
    const tips = summary.top_tips as string[] | undefined
    return tips?.length
      ? `Here are the key areas to focus on:\n${tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : 'Focus on the fundamentals shown in the analysis summary.'
  }
  if (q.includes('strength') || q.includes('good')) {
    const strengths = summary.strengths as string[] | undefined
    return strengths?.length
      ? `Your strengths from this session:\n${strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : "The analysis didn't highlight specific strengths."
  }
  if (q.includes('drill') || q.includes('practice')) {
    return summary.priority_drill
      ? `Recommended drill: ${summary.priority_drill}`
      : 'No specific drill recommended for this session.'
  }
  if (q.includes('event') || q.includes('shot')) {
    const events = summary.shot_events as Array<Record<string, unknown>> | undefined
    if (events?.length) {
      return `There were ${events.length} events detected. Here's a summary:\n${events.map((e, i) => `${i + 1}. ${e.timestamp}s - ${e.event_type}: Score ${e.form_score}/10`).join('\n')}`
    }
    return `The analysis detected ${summary.total_events ?? 0} events.`
  }

  return `${summary.summary || "Here's a summary of the analysis."} The form score was ${summary.form_score ?? 'N/A'}/10. Feel free to ask about specific events, tips, strengths, or drills.`
}

const defaultChatWithEngine: EngineChatFn = async ({
  engineJobId,
  message,
  conversationHistory,
  systemPrompt,
}) => {
  try {
    const engineRes = await withTimeout(
      `${ENGINE_URL}/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineServiceHeaders(),
        },
        body: JSON.stringify({
          job_id: engineJobId,
          message,
          conversation_history: conversationHistory,
          system_prompt: systemPrompt,
        }),
      },
      30000,
    )

    if (!engineRes.ok) return null
    const data = (await engineRes.json()) as {
      reply?: string
      message?: string
    }
    return data.reply || data.message || null
  } catch {
    return null
  }
}

/** Answer one chat turn: engine reply first, keyword fallback otherwise. */
export const answerChatTurn = async (
  input: ChatTurnInput,
  deps?: ChatTurnDeps,
): Promise<string> => {
  const systemPrompt = buildChatSystemPrompt(input.summary)
  let reply: string | null
  try {
    reply = await (deps?.chatWithEngine ?? defaultChatWithEngine)({
      engineJobId: input.engineJobId,
      message: input.message,
      conversationHistory: input.conversationHistory,
      systemPrompt,
    })
  } catch {
    reply = null
  }
  return reply || keywordFallback(input.message, input.summary)
}
