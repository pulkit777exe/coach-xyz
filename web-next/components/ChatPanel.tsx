'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { sendChatMessage, getConversation, type ChatMessage } from '@/lib/api'
import { ChatMessageBubble } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatTyping } from './ChatTyping'
import { QuickActions } from './QuickActions'
import type { JobStatus } from '@/types'

interface ChatPanelProps {
  jobId: string
  jobStatus: JobStatus | null
  onSeekTo?: (timestamp: number) => void
}

export default function ChatPanel({ jobId, jobStatus, onSeekTo }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasLoadedRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load conversation history
  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true

    const loadHistory = async () => {
      try {
        const { messages: history } = await getConversation(jobId)
        if (history.length > 0) {
          setMessages(history)
        }
      } catch {
        // No history yet, that's fine
      } finally {
        setIsLoadingHistory(false)
      }
    }
    loadHistory()
  }, [jobId])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  const handleSend = async (text: string) => {
    if (!text.trim() || isTyping) return

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      created_at: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setIsTyping(true)

    try {
      const response = await sendChatMessage(jobId, text)
      const assistantMsg: ChatMessage = {
        id: `resp-${Date.now()}`,
        role: 'assistant',
        content: response.reply,
        timestamp_refs: response.timestamp_refs,
        event_refs: response.event_refs,
        created_at: Date.now(),
      }
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, assistantMsg))
    } catch {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: 'Failed to get response. Please try again.',
        created_at: Date.now(),
      }
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, errorMsg))
    } finally {
      setIsTyping(false)
    }
  }

  const handleQuickAction = (prompt: string) => {
    handleSend(prompt)
  }

  const summary = jobStatus?.summary

  return (
    <div className="flex h-full flex-col bg-transparent">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {isLoadingHistory && (
              <div className="text-center text-[var(--cream-40)] text-sm py-8">
                Loading conversation...
              </div>
            )}

            {!isLoadingHistory && messages.length === 0 && summary && (
              <div className="space-y-6">
                {/* Initial analysis summary card */}
                <div className="rounded-none border border-[var(--cream-10)] bg-[var(--cream-05)] p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">
                      {summary.sport === 'basketball' ? '🏀' :
                       summary.sport === 'football' ? '⚽' :
                       summary.sport === 'cricket' ? '🏏' : '🎯'}
                    </span>
                    <div>
                      <h3 className="font-serif text-lg text-[var(--fg)] capitalize">
                        {summary.sport} Analysis Complete
                      </h3>
                      <p className="text-[0.65rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">
                        {summary.total_events} events detected
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="font-serif text-3xl text-[var(--fg)]">{summary.form_score}</p>
                      <p className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">Form Score</p>
                    </div>
                    <div>
                      <p className="font-serif text-lg text-[var(--fg)]">{summary.overall_rating}</p>
                      <p className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">Rating</p>
                    </div>
                    <div>
                      <p className="font-serif text-lg text-[var(--fg)]">{summary.success_rate_percent}%</p>
                      <p className="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--cream-40)]">Success Rate</p>
                    </div>
                  </div>
                </div>

                {/* Welcome message */}
                <ChatMessageBubble
                  message={{
                    id: 'welcome',
                    role: 'assistant',
                    content: `Analysis complete! I found **${summary.total_events} events** in your ${summary.sport} video with an overall form score of **${summary.form_score}/10**.\n\nAsk me anything about your technique — I can break down specific events, suggest drills, or compare your best and worst moments.`,
                    created_at: Date.now(),
                  }}
                  onSeekTo={onSeekTo}
                />

                <QuickActions
                  onAction={handleQuickAction}
                  disabled={isTyping}
                  hasSummary={!!summary}
                />
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessageBubble
                key={msg.id}
                message={msg}
                onSeekTo={onSeekTo}
              />
            ))}

            {isTyping && <ChatTyping />}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-[var(--cream-05)] bg-[var(--bg)]/80 backdrop-blur-md">
          <div className="mx-auto max-w-3xl px-4 py-4">
            <ChatInput
              onSend={handleSend}
              disabled={isTyping}
              placeholder="Ask about your analysis..."
            />
          </div>
        </div>
      </div>
  )
}
