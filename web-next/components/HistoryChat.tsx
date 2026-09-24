'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Slide } from 'loading-dev'
import { getHistoryChatMessages, sendHistoryChatMessage } from '@/lib/api'
import type { ChatMessage } from '@/types'
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [historyError, setHistoryError] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getHistoryChatMessages(auth0Id, jobId)
      .then((res) => setMessages(res.messages || []))
      .catch(() => setHistoryError(true))
      .finally(() => setInitialLoading(false))
  }, [auth0Id, jobId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      created_at: Date.now() / 1000,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await sendHistoryChatMessage(auth0Id, jobId, text)
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.message,
        created_at: Date.now() / 1000,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: 'Failed to get response. Please try again.',
        created_at: Date.now() / 1000,
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, auth0Id, jobId])

  const sportEmoji: Record<string, string> = {
    basketball: '🏀',
    football: '⚽',
    cricket: '🏏',
    tennis: '🎾',
    baseball: '⚾',
    hockey: '🏒',
    unknown: '🎯',
  }

  return (
    <div className="flex flex-col h-full">
      {summary && (
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">
              {sportEmoji[(summary.sport as string) || 'unknown'] || '🎯'}
            </span>
            <div>
              <p className="text-[14px] font-medium text-foreground capitalize">
                {(summary.sport as string) || 'Sport'} Analysis
              </p>
              <p className="text-[13px] text-muted-foreground tabular-nums">
                Score: {(summary.form_score as number) ?? '—'}/10 ·{' '}
                {(summary.overall_rating as string) || ''}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {initialLoading ? (
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground text-sm py-8">
            <Slide size={24} />
            Loading conversation...
          </div>
        ) : historyError ? (
          <div className="text-center py-8">
            <p className="text-[14px] text-destructive mb-2">Failed to load conversation history</p>
            <p className="text-[13px] text-muted-foreground">You can still send new messages.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-foreground text-[17px] font-semibold tracking-[-0.01em] mb-2">
              Ask about your analysis
            </p>
            <p className="text-muted-foreground text-[14px]">
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
                  type="button"
                  onClick={() => {
                    setInput(q)
                  }}
                  className="rounded-[6px] border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
                className={`max-w-[80%] rounded-[8px] px-4 py-3 text-[14px] leading-6 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : msg.role === 'system'
                      ? 'bg-muted text-muted-foreground border border-border'
                      : 'border border-border bg-card text-foreground'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-[8px] border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
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
            className="flex-1 rounded-[8px] border border-border bg-background px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
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
