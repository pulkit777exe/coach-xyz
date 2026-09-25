'use client'

interface QuickActionsProps {
  onAction: (prompt: string) => void
  disabled?: boolean
  hasSummary?: boolean
}

const ACTIONS = [
  {
    label: 'Strengths',
    icon: '✓',
    prompt: 'What are my strengths in this session?',
  },
  {
    label: 'Weaknesses',
    icon: '⚡',
    prompt: 'What should I improve on?',
  },
  {
    label: 'Drill',
    icon: '🎯',
    prompt: 'Give me a practice drill for my weakest area.',
  },
  {
    label: 'Compare',
    icon: '⚖',
    prompt: 'Compare my best and worst shots.',
  },
]

export function QuickActions({ onAction, disabled, hasSummary }: QuickActionsProps) {
  if (!hasSummary) return null

  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => onAction(action.prompt)}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-[6px] border border-border bg-card px-3 py-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          <span>{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}
