import type { ReactNode } from 'react'

interface PageHeaderProps {
  trail?: string[]
  title: string
  description?: string
  actions?: ReactNode
}

export default function PageHeader({ trail, title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-7">
      {trail && trail.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5">
          {trail.map((crumb, i) => {
            const isLast = i === trail.length - 1
            return (
              <span key={crumb} className="flex items-center gap-1.5">
                {i > 0 ? <span className="text-muted-foreground/60">/</span> : null}
                <span
                  className={
                    isLast
                      ? 'text-meta leading-5 text-foreground'
                      : 'text-meta leading-5 text-muted-foreground transition-colors hover:text-foreground hover:underline'
                  }
                >
                  {crumb}
                </span>
              </span>
            )
          })}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-[1.2] tracking-[-0.015em] text-foreground lg:text-[32px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-[640px] text-body leading-[1.5] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
