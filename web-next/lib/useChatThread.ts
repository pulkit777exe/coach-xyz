// ── Chat thread ──────────────────────────────────────────────────────────────
// One home for the history-load + scroll + message-list state shared by the
// chat panels: race-guarded initial load, error/loading flags, bottom
// scrolling, and message factories with contract-shaped ids/timestamps.
// Send transports stay per panel (streaming generator vs history POST).

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatMessage } from '@/types'

/** Client-side message with a unique id and epoch-seconds timestamp. */
export const makeChatMessage = (
  role: ChatMessage['role'],
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  created_at: Date.now() / 1000,
  ...extra,
})

export const makeUserMessage = (content: string): ChatMessage => makeChatMessage('user', content)

export const makeErrorMessage = (content: string): ChatMessage => makeChatMessage('system', content)

export function useChatThread(opts: {
  /** Reloads history when this changes (e.g. auth0Id + jobId). */
  scopeKey: string
  load: () => Promise<ChatMessage[]>
  onError?: (error: unknown) => void
  /** Extra scroll trigger (e.g. typing/streaming text changes). */
  scrollKey?: unknown
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const loadRef = useRef(opts.load)
  const onErrorRef = useRef(opts.onError)

  // Latest-callback refs (written in an effect — never during render).
  useEffect(() => {
    loadRef.current = opts.load
    onErrorRef.current = opts.onError
  })

  useEffect(() => {
    let cancelled = false
    void loadRef
      .current()
      .then(
        (history) => {
          if (!cancelled) setMessages(history)
        },
        (error: unknown) => {
          if (cancelled) return
          onErrorRef.current?.(error)
          setHasError(true)
        },
      )
      .finally(() => {
        if (!cancelled) setLoadedFor(opts.scopeKey)
      })
    return () => {
      cancelled = true
    }
  }, [opts.scopeKey])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom, opts.scrollKey])

  return {
    messages,
    setMessages,
    isLoading: loadedFor !== opts.scopeKey,
    hasError,
    messagesEndRef,
    scrollToBottom,
  }
}
