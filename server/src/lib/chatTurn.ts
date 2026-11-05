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
    if (typeof summary.form_score === 'number') {
      contextParts.push(
        `Experimental form score (provisional, unvalidated weighting): ${summary.form_score}/10`,
      )
    }
    if (summary.overall_rating) {
      contextParts.push(`Experimental rating label (unvalidated): ${summary.overall_rating}`)
    }
    contextParts.push(
      'The experimental score is not a validated measure of performance and must not be used for selection decisions. Prefer criterion-level evidence.',
    )
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
      contextParts.push(`Events (${events.length}):`)
      events.forEach((e, i) => {
        const state = typeof e.event_state === 'string' ? e.event_state : 'unstated'
        const score =
          typeof e.form_score === 'number'
            ? `Experimental score ${e.form_score}/10.`
            : 'No experimental score (insufficient measured coverage).'
        const lifecycle =
          state === 'confirmed'
            ? 'Confirmed event.'
            : `Event state: ${state} — not a confirmed sports action.`
        contextParts.push(
          `  ${i + 1}. ${e.timestamp}s - ${e.event_type}. ${lifecycle} ${score} ${e.feedback || ''}`,
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
    const score =
      typeof summary.form_score === 'number'
        ? `the experimental form score is ${summary.form_score}/10`
        : 'there is no experimental form score because too few criteria could be measured'
    const rating = summary.overall_rating
      ? ` with the experimental label "${summary.overall_rating}"`
      : ''
    return `Based on the analysis, ${score}${rating}. This composite uses provisional, unvalidated weighting and is not an independently validated measure of athletic performance. ${summary.summary || ''}`
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
    const detection = summary.event_detection as Record<string, unknown> | undefined
    if (events?.length) {
      const confirmed = events.filter((e) => e.event_state === 'confirmed').length
      const candidates = events.filter((e) => e.event_state === 'candidate').length
      const counts =
        typeof detection?.confirmed === 'number'
          ? `${detection.confirmed} confirmed`
          : `${confirmed} confirmed`
      return `The analysis found ${counts} event(s)${candidates > 0 ? ` and ${candidates} unconfirmed candidate(s)` : ''}. Here's a summary:\n${events
        .map((e, i) => {
          const state = typeof e.event_state === 'string' ? e.event_state : 'unstated'
          const score =
            typeof e.form_score === 'number'
              ? `experimental score ${e.form_score}/10`
              : 'no experimental score'
          return `${i + 1}. ${e.timestamp}s - ${e.event_type} (${state}): ${score}`
        })
        .join('\n')}`
    }
    return `The analysis detected ${summary.total_events ?? 0} event(s).`
  }

  const scoreText =
    typeof summary.form_score === 'number'
      ? `The experimental form score was ${summary.form_score}/10.`
      : 'No experimental form score was available.'
  return `${summary.summary || "Here's a summary of the analysis."} ${scoreText} Feel free to ask about specific events, tips, strengths, or drills.`
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
