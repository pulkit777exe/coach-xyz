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
  initialAnalysis,
}: {
  auth0Id: string
  initialAnalysis: {
    server_job_id: string
    summary_json: Record<string, unknown> | null
  }
}) {
  return (
    <HistoryChatPanel
      auth0Id={auth0Id}
      jobId={initialAnalysis.server_job_id}
      summary={initialAnalysis.summary_json}
    />
  )
}

function HistoryChatPanel({
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
              <p className="text-body font-medium text-foreground capitalize">
                {(summary.sport as string) || 'Sport'} Analysis
              </p>
              <p className="text-meta text-muted-foreground tabular-nums">
                Score: {(summary.form_score as number) ?? '—'}/10 ·{' '}
                {(summary.overall_rating as string) || ''}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {initialLoading && (
          <div className="text-center text-muted-foreground py-8">Loading chat history...</div>
        )}

        {historyError && (
          <div className="text-center text-destructive py-8">Failed to load chat history.</div>
        )}

        {!initialLoading && !historyError && messages.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            <p>No messages yet. Ask questions about this analysis!</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-[6px] p-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-foreground'
              }`}
            >
              <p className="text-body whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-border">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this analysis..."
            disabled={loading}
            className="flex-1 rounded-[6px] border border-input bg-background px-3 py-2 text-body focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            {loading ? 'Sending...' : 'Send'}
          </Button>
        </form>
      </div>
    </div>
  )
}
