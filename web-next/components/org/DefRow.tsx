import type { ReactNode } from 'react'

export function DefRow({
  label,
  value,
  mono,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="w-[180px] shrink-0 text-body leading-5 text-muted-foreground">{label}</span>
      <span
        className={
          mono
            ? 'min-w-0 break-all text-right font-mono text-caption leading-4 text-muted-foreground'
            : 'text-body leading-5 tabular-nums text-foreground'
        }
      >
        {value}
      </span>
    </div>
  )
}

export default DefRow
