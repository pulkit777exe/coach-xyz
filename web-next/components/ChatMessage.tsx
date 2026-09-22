'use client'

import TimestampPill, { formatTimestampClock } from '@/components/TimestampPill'
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
              <TimestampPill
                key={ts}
                seconds={ts}
                format="clock"
                onSeek={onSeekTo}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatTimestamp(seconds: number): string {
  return formatTimestampClock(seconds)
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
