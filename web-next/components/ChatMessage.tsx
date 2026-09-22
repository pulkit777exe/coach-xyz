'use client'

import type { ChatMessage } from '@/types'

interface ChatMessageBubbleProps {
  message: ChatMessage
  onSeekTo?: (timestamp: number) => void
}

export function ChatMessageBubble({ message, onSeekTo }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <span className="inline-block rounded-2xl border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[slideUp_0.3s_ease-out]`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-4 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-card text-foreground shadow-sm'
        }`}
      >
        {!isUser && (
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[0.65rem] font-semibold text-muted-foreground">
              C
            </span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Coach
            </span>
          </div>
        )}

        <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {renderContent(message.content, onSeekTo, message.timestamp_refs)}
        </div>

        {message.timestamp_refs && message.timestamp_refs.length > 0 && onSeekTo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.timestamp_refs.slice(0, 5).map((ts) => (
              <button
                key={ts}
                onClick={() => onSeekTo(ts)}
                className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted px-2 py-1 text-[0.65rem] font-mono text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {formatTimestamp(ts)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

function renderContent(
  content: string,
  onSeekTo?: (timestamp: number) => void,
  timestampRefs?: number[],
) {
  const parts = content.split(/(\*\*.*?\*\*|__.*?__|\*.*?\*|_.*?_|`.*?`|\[.*?\]\(.*?\))/g)

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    // Italic
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('_') && part.endsWith('_') && !part.startsWith('__')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (onSeekTo && timestampRefs) {
      const tsMatch = part.match(/^(\d+\.?\d*)s$/)
      if (tsMatch) {
        const ts = parseFloat(tsMatch[1])
        return (
          <button
            key={i}
            onClick={() => onSeekTo(ts)}
            className="font-mono text-muted-foreground underline decoration-primary/50 underline-offset-2 hover:text-foreground"
          >
            {formatTimestamp(ts)}
          </button>
        )
      }
    }
    return <span key={i}>{part}</span>
  })
}
