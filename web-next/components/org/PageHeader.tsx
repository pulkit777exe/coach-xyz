import type { ReactNode } from 'react'

interface PageHeaderProps {
  trail: string[]
  title: string
  description?: string
  actions?: ReactNode
}

export default function PageHeader({ trail, title, description, actions }: PageHeaderProps) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-[var(--marketing-white)]/60 mb-1">
        {trail.map((crumb, i) => (
          <span key={crumb} className="flex items-center gap-2">
            {i > 0 && <span className="text-[var(--marketing-white)]/40">/</span>}
            <span className={i === trail.length - 1 ? 'text-[var(--marketing-white)]' : ''}>{crumb}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-balance text-[var(--marketing-white)]">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-[var(--marketing-white)]/60">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
