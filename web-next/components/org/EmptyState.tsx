import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
}

export default function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'py-8' : 'py-14'
      }`}
    >
      <div className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-[8px] bg-muted text-muted-foreground/70">
        {icon ?? <FileText className="h-5 w-5" aria-hidden="true" />}
      </div>
      <p className="text-title font-medium leading-[1.4] text-foreground">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-[360px] text-body leading-[1.5] text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
