'use client'

import { useState, useCallback } from 'react'
import { getHistoryChatMessages, sendHistoryChatMessage } from '@/lib/chat'
import { SPORT_EMOJI } from '@/lib/sports'
import {
  makeChatMessage,
  makeErrorMessage,
  makeUserMessage,
  useChatThread,
} from '@/lib/useChatThread'
import { Button } from '@/components/9ui/ui/button'

export default function HistoryChat({
  auth0Id,
  jobId,
  summary,
}: {
  auth0Id: string
  jobId: string
  summary: Record<string, unknown> | null
}) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const {
    messages,
    setMessages,
    isLoading: initialLoading,
    hasError: historyError,
    messagesEndRef,
  } = useChatThread({
    scopeKey: `${auth0Id}:${jobId}`,
    load: () => getHistoryChatMessages(auth0Id, jobId).then((res) => res.messages || []),
  })

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = makeUserMessage(text)
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await sendHistoryChatMessage(auth0Id, jobId, text)
      const assistantMsg = makeChatMessage('assistant', res.message)
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      const errorMsg = makeErrorMessage('Failed to get response. Please try again.')
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, auth0Id, jobId, setMessages])

  return (
    <div className="flex flex-col h-full">
      {summary && (
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">
              {SPORT_EMOJI[(summary.sport as string) || 'unknown'] ?? '🎯'}
            </span>
            <div>
              <p className="text-sm text-foreground capitalize">
                {(summary.sport as string) || 'Sport'} Analysis
              </p>
              <p className="text-xs text-muted-foreground">
                Score: {(summary.form_score as number) ?? '—'}/10 ·{' '}
                {(summary.overall_rating as string) || ''}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {initialLoading ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            Loading conversation...
          </div>
        ) : historyError ? (
          <div className="text-center py-8">
            <p className="text-destructive text-sm mb-2">Failed to load conversation history</p>
            <p className="text-muted-foreground text-xs">You can still send new messages.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-foreground font-bold text-lg mb-2">Ask about your analysis</p>
            <p className="text-muted-foreground text-sm">
              Get insights on technique, tips, strengths, or specific events.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {[
                'What are my main areas to improve?',
                'Show my strengths',
                'What drill should I practice?',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q)
                  }}
                  className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm text-foreground ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.role === 'system'
                      ? 'bg-muted text-muted-foreground border border-border'
                      : 'border border-border bg-card shadow-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about your analysis..."
            className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50"
            disabled={loading}
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()} className="px-4">
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
