import type { ReactNode } from 'react'

/**
 * Canonical settings row — one pattern shared by the settings panel and the
 * preferences section (previously two near-identical local copies).
 *
 * Left: 14px/500 title + optional 13px muted description.
 * Right: control, pinned and never squeezed (`shrink-0`).
 * Stacks vertically below sm, switches to a space-between row from sm up.
 */
export default function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-[1.4] text-foreground">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-[1.5] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
