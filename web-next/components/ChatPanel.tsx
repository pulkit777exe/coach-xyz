'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { sendChatMessageStream } from '@/lib/api'
import type { ChatMessage } from '@/types'
import { ChatMessageBubble } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatTyping } from './ChatTyping'
import { QuickActions } from './QuickActions'
import { getConversation } from '@/lib/api'
import type { JobStatus } from '@/types'
import { SPORT_EMOJI } from '@/lib/sports'

// Timestamps captured once at module load: welcome/streaming bubbles are
// transient render artifacts, not real history, so a stable created_at is fine
// and keeps render pure.
const WELCOME_MESSAGE_AT = Date.now()
const STREAMING_MESSAGE_AT = Date.now()

interface ChatPanelProps {
  jobId: string
  jobStatus: JobStatus | null
  onSeekTo?: (timestamp: number) => void
}

export default function ChatPanel({ jobId, jobStatus, onSeekTo }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasLoadedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Cancel any in-flight stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

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
      } catch (err) {
        console.error('Failed to load chat history:', err)
        setHistoryError(true)
      } finally {
        setIsLoadingHistory(false)
      }
    }
    loadHistory()
  }, [jobId])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, streamingText, scrollToBottom])

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return

    // Cancel any previous stream
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      created_at: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setIsTyping(true)
    setStreamingText('')

    try {
      let finalText = ''
      let finalTimestampRefs: number[] = []
      let finalEventRefs: number[] = []

      for await (const event of sendChatMessageStream(jobId, text, controller.signal)) {
        if (event.type === 'token') {
          finalText += event.text
          setStreamingText(finalText)
        } else if (event.type === 'done') {
          finalText = event.text
          finalTimestampRefs = event.timestamp_refs
          finalEventRefs = event.event_refs
        } else if (event.type === 'error') {
          const errorMsg: ChatMessage = {
            id: `err-${Date.now()}`,
            role: 'system',
            content: event.message,
            created_at: Date.now(),
          }
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, errorMsg))
          setStreamingText('')
          setIsTyping(false)
          return
        }
      }

      // Stream complete — add final message
      const assistantMsg: ChatMessage = {
        id: `resp-${Date.now()}`,
        role: 'assistant',
        content: finalText,
        timestamp_refs: finalTimestampRefs,
        event_refs: finalEventRefs,
        created_at: Date.now(),
      }
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, assistantMsg))
      setStreamingText('')
    } catch {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: 'Failed to get response. Please try again.',
        created_at: Date.now(),
      }
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, errorMsg))
      setStreamingText('')
    } finally {
      setIsTyping(false)
    }
  }, [jobId, isTyping])

  const handleQuickAction = useCallback((prompt: string) => {
    handleSend(prompt)
  }, [handleSend])

  const summary = jobStatus?.summary

  const welcomeMessage = useMemo<ChatMessage>(() => ({
    id: 'welcome',
    role: 'assistant',
    content: `Analysis complete! I found **${summary?.total_events ?? 0} events** in your ${summary?.sport ?? 'sports'} video with an overall form score of **${summary?.form_score ?? 0}/10**.\n\nAsk me anything about your technique — I can break down specific events, suggest drills, or compare your best and worst moments.`,
    created_at: WELCOME_MESSAGE_AT,
  }), [summary])

  return (
    <div className="flex h-full flex-col bg-transparent">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {isLoadingHistory && (
              <div className="text-center text-(--cream-40) text-sm py-8">
                Loading conversation...
              </div>
            )}

            {historyError && !isLoadingHistory && (
              <div className="text-center text-(--cream-40) text-xs py-4 opacity-60">
                Could not load previous messages
              </div>
            )}

            {!isLoadingHistory && messages.length === 0 && summary && (
              <div className="space-y-6">
                {/* Initial analysis summary card */}
                <div className="rounded-none border border-(--cream-10) bg-(--cream-05) p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">
                      {SPORT_EMOJI[summary.sport ?? ''] ?? '🎯'}
                    </span>
                    <div>
                      <h3 className="font-serif text-lg text-(--fg) capitalize">
                        {summary.sport} Analysis Complete
                      </h3>
                      <p className="text-[0.65rem] uppercase tracking-[0.15em] text-(--cream-40)">
                        {summary.total_events ?? 0} events detected
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="font-serif text-3xl text-(--fg)">{summary.form_score}</p>
                      <p className="text-[0.6rem] uppercase tracking-[0.15em] text-(--cream-40)">Form Score</p>
                    </div>
                    <div>
                      <p className="font-serif text-lg text-(--fg)">{summary.overall_rating}</p>
                      <p className="text-[0.6rem] uppercase tracking-[0.15em] text-(--cream-40)">Rating</p>
                    </div>
                    <div>
                      <p className="font-serif text-lg text-(--fg)">{summary.success_rate_percent ?? 0}%</p>
                      <p className="text-[0.6rem] uppercase tracking-[0.15em] text-(--cream-40)">Success Rate</p>
                    </div>
                  </div>
                </div>

                {/* Welcome message */}
                <ChatMessageBubble
                  message={welcomeMessage}
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

            {/* Streaming message bubble */}
            {streamingText && (
              <ChatMessageBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingText,
                  created_at: STREAMING_MESSAGE_AT,
                }}
                onSeekTo={onSeekTo}
              />
            )}

            {isTyping && !streamingText && <ChatTyping />}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-(--cream-05) bg-(--bg)/80 backdrop-blur-md">
          <div className="mx-auto max-w-3xl px-4 py-4">
            <ChatInput
              onSend={handleSend}
              disabled={isTyping || isLoadingHistory}
              placeholder={isLoadingHistory ? 'Loading...' : 'Ask about your analysis...'}
            />
          </div>
        </div>
      </div>
  )
}
