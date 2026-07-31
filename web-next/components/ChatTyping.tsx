'use client'

export function ChatTyping() {
  return (
    <div className="flex justify-start">
      <div className="rounded-none border border-[var(--cream-10)] bg-[var(--cream-05)] px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--cream-40)] uppercase tracking-wider">
            Coach
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--cream-40)] animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-[var(--cream-40)] animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-[var(--cream-40)] animate-bounce" />
        </div>
      </div>
    </div>
  )
}
