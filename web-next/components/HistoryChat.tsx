'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getHistoryChatMessages, sendHistoryChatMessage } from '@/lib/api'
import type { ChatMessage } from '@/types'

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
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getHistoryChatMessages(auth0Id, jobId)
      .then(res => setMessages(res.messages || []))
      .catch(() => {})
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
    setMessages(prev => [...prev, userMsg])
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
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: 'Failed to get response. Please try again.',
        created_at: Date.now() / 1000,
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, auth0Id, jobId])

  const sportEmoji: Record<string, string> = {
    basketball: '🏀', football: '⚽', cricket: '🏏',
    tennis: '🎾', baseball: '⚾', hockey: '🏒', unknown: '🎯',
  }

  return (
    <div className="flex flex-col h-full">
      {summary && (
        <div className="border-b border-(--cream-05) p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{sportEmoji[(summary.sport as string) || 'unknown'] || '🎯'}</span>
            <div>
              <p className="text-sm text-(--fg) capitalize">{summary.sport as string || 'Sport'} Analysis</p>
              <p className="text-xs text-(--cream-40)">Score: {summary.form_score as number ?? '—'}/10 · {summary.overall_rating as string || ''}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {initialLoading ? (
          <div className="text-center text-(--cream-40) text-sm py-8">Loading conversation...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-(--fg) font-serif text-lg mb-2">Ask about your analysis</p>
            <p className="text-(--cream-40) text-sm">Get insights on technique, tips, strengths, or specific events.</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {['What are my main areas to improve?', 'Show my strengths', 'What drill should I practice?'].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q) }}
                  className="text-xs px-3 py-1.5 border border-(--cream-10) text-(--cream-40) hover:text-(--fg) hover:border-(--cream-20) transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-(--fg) text-(--bg)'
                  : msg.role === 'system'
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'border border-(--cream-10) text-(--fg)'
              }`}>
                {msg.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="border border-(--cream-10) px-4 py-2 text-sm text-(--cream-40)">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-(--cream-05) p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about your analysis..."
            className="flex-1 bg-transparent border border-(--cream-10) px-4 py-2 text-sm text-(--fg) placeholder-(--cream-40) focus:outline-none focus:border-(--cream-20)"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-(--fg) text-(--bg) text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
