'use client'

export function ChatTyping() {
  return (
    <div className="flex justify-start">
      <div className="rounded-[8px] border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
            C
          </span>
          <span className="text-[12px] font-medium text-muted-foreground">Coach</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" />
        </div>
      </div>
    </div>
  )
}
