// ── Analysis chat response helpers ───────────────────────────────────────────
// Deterministic fallback responder for the analysis chat endpoint
// (routes/chatHistory.ts): used when the engine /chat call is unreachable.
// Mechanical extraction from routes/auth.ts.

export function generateSimpleResponse(
  question: string,
  summary: Record<string, unknown> | null,
): string {
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
