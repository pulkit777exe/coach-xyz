'use client'

import { useState, type DragEvent } from 'react'
import { cn } from '@/lib/utils'

interface ReorderListProps<T> {
  items: T[]
  getId: (item: T) => string
  getLabel: (item: T) => string
  onReorder: (items: T[]) => void
  label: string
  children: (item: T) => React.ReactNode
  className?: string
}

export function ReorderList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  label,
  children,
  className,
}: ReorderListProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
    const next = [...items]
    const [removed] = next.splice(from, 1)
    next.splice(to, 0, removed)
    onReorder(next)
  }

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const from = items.findIndex((i) => getId(i) === dragId)
    const to = items.findIndex((i) => getId(i) === targetId)
    move(from, to)
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className={cn('space-y-1', className)}>
      <span className="sr-only">{label}</span>
      {items.map((item, index) => {
        const id = getId(item)
        return (
          <div
            key={id}
            draggable
            onDragStart={() => setDragId(id)}
            onDragOver={(e: DragEvent) => {
              e.preventDefault()
              setOverId(id)
            }}
            onDrop={(e: DragEvent) => {
              e.preventDefault()
              handleDrop(id)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            className={cn(
              'rounded-[6px] transition-shadow',
              overId === id && 'ring-2 ring-ring/40',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="cursor-grab select-none text-muted-foreground"
                title="Drag to reorder"
                aria-hidden
              >
                ⠿
              </span>
              <div className="min-w-0 flex-1" title={getLabel(item)}>
                {children(item)}
              </div>
              <button
                type="button"
                onClick={() => move(index, Math.max(0, index - 1))}
                disabled={index === 0}
                aria-label="Move up"
                className="cursor-pointer rounded-[4px] px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, Math.min(items.length - 1, index + 1))}
                disabled={index === items.length - 1}
                aria-label="Move down"
                className="cursor-pointer rounded-[4px] px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
