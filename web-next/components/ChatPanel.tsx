'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import {
  makeChatMessage,
  makeErrorMessage,
  makeUserMessage,
  useChatThread,
} from '@/lib/useChatThread'
import { sendChatMessageStream } from '@/lib/chat'
import { toCoachAIError } from '@/lib/errors'
import { ChatMessageBubble } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ChatTyping } from './ChatTyping'
import { QuickActions } from './QuickActions'
import { getConversation } from '@/lib/chat'
import type { JobStatus } from '@/types'

const STREAMING_MESSAGE_AT = Math.floor(Date.now() / 1000)
import { SPORT_EMOJI } from '@/lib/sports'

interface ChatPanelProps {
  jobId: string
  jobStatus: JobStatus | null
  onSeekTo?: (seconds: number) => void
}

export default function ChatPanel({ jobId, jobStatus, onSeekTo }: ChatPanelProps) {
  const [isTyping, setIsTyping] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const {
    messages,
    setMessages,
    isLoading: isLoadingHistory,
    hasError: historyError,
    messagesEndRef,
  } = useChatThread({
    scopeKey: jobId,
    load: () => getConversation(jobId).then((res) => res.messages),
    onError: (err) => console.error('Failed to load chat history:', err),
    scrollKey: `${isTyping}:${streamingText}`,
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || isTyping) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const userMsg = makeUserMessage(text.trim())
      setMessages((prev) => [...prev, userMsg])
      setIsTyping(true)
      setStreamingText('')

      try {
        let finalText = ''
        let finalTimestampRefs: number[] = []
        let finalEventRefs: number[] = []

        for await (const event of sendChatMessageStream(jobId, text.trim(), controller.signal)) {
          if (event.type === 'token') {
            finalText += event.text
            setStreamingText(finalText)
          } else if (event.type === 'done') {
            finalText = event.text
            finalTimestampRefs = event.timestamp_refs
            finalEventRefs = event.event_refs
          } else if (event.type === 'error') {
            const errorMsg = makeErrorMessage(event.message)
            setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, errorMsg))
            setStreamingText('')
            setIsTyping(false)
            return
          }
        }

        const assistantMsg = makeChatMessage('assistant', finalText, {
          timestamp_refs: finalTimestampRefs,
          event_refs: finalEventRefs,
        })
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, assistantMsg))
        setStreamingText('')
      } catch (error: unknown) {
        // A user-cancelled request has no UI error to show. For transport
        // failures, preserve the canonical message produced by apiFetch /
        // errorFromResponse (quota, quota/timeout details, etc.) instead of
        // replacing it with an unrelated generic sentence.
        if (controller.signal.aborted) return
        const errorMsg = makeErrorMessage(toCoachAIError(error).message)
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id).concat(userMsg, errorMsg))
        setStreamingText('')
      } finally {
        setIsTyping(false)
      }
    },
    [jobId, isTyping, setMessages],
  )

  const handleQuickAction = useCallback(
    (prompt: string) => {
      handleSend(prompt)
    },
    [handleSend],
  )

  const sport = jobStatus?.summary?.sport as string | undefined

  const sportEmoji = useMemo(() => {
    return (sport && SPORT_EMOJI[sport]) || '🎯'
  }, [sport])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="text-xl">{sportEmoji}</span>
        <div>
          <h3 className="text-body font-semibold text-foreground">AI Coach Chat</h3>
          <p className="text-meta text-muted-foreground">
            Ask questions about your {sport || 'form'} analysis
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isLoadingHistory && (
          <div className="flex items-center justify-center py-8 text-meta text-muted-foreground">
            Loading chat history...
          </div>
        )}

        {historyError && (
          <div className="rounded-[6px] border border-destructive/20 bg-destructive/10 p-3 text-meta text-destructive">
            Failed to load previous messages
          </div>
        )}

        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} onSeekTo={onSeekTo} />
        ))}

        {isTyping && streamingText && (
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

      {/* Quick Actions (only show when not typing and have summary) */}
      {!isTyping && jobStatus?.summary && (
        <QuickActions
          onAction={handleQuickAction}
          disabled={isTyping}
          hasSummary={Boolean(jobStatus?.summary)}
        />
      )}

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isTyping} />
    </div>
  )
}
