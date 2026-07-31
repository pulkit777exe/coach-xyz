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
          className="inline-flex items-center gap-2 rounded-none border border-[var(--cream-10)] bg-[var(--cream-05)] px-4 py-2 text-xs text-[var(--cream-40)] transition-all hover:border-[var(--cream-20)] hover:text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span>{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}
