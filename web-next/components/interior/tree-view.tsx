'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface TreeNode {
  id: string
  label: string
  children?: TreeNode[]
}

interface TreeViewProps {
  label: string
  nodes: TreeNode[]
  className?: string
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const initialOpen = depth === 0
  const [open, setOpen] = useState(initialOpen)
  const hasChildren = !!node.children?.length

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        type="button"
        onClick={() => hasChildren && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-start gap-2 rounded-[4px] py-1 text-left text-[14px] text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          hasChildren ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <span className="w-3 shrink-0 text-muted-foreground">
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </span>
        <span>{node.label}</span>
      </button>
      {open && hasChildren && (
        <div className="mt-1 space-y-1">
          {node.children?.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TreeView({ label, nodes, className }: TreeViewProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <span className="sr-only">{label}</span>
      {nodes.map((node) => (
        <TreeItem key={node.id} node={node} depth={0} />
      ))}
    </div>
  )
}
