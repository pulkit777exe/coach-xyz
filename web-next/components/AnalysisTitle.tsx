'use client'

import { useState } from 'react'
import { renameAnalysis } from '@/lib/api'

export default function AnalysisTitle({
  auth0Id,
  jobId,
  displayName,
  fileName,
}: {
  auth0Id: string
  jobId: string
  displayName: string | null
  fileName: string | null
}) {
  const [name, setName] = useState(displayName || fileName || 'Untitled video')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const save = async () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) {
      setName(trimmed)
      try {
        await renameAnalysis(auth0Id, jobId, trimmed)
      } catch {
        setName(name)
      }
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Analysis name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
        className="text-[30px] sm:text-[32px] font-bold tracking-[-0.015em] leading-tight text-foreground bg-transparent border-b border-border w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-[4px] py-0.5"
      />
    )
  }

  // The heading stays an <h1> (it is the page's only h1 and screen readers
  // announce it as such), but the rename affordance is a real <button> inside
  // it: Enter/Space, focus and the button role come from the element instead of
  // from hand-rolled key handling. Tailwind's preflight gives buttons
  // `font: inherit`, so the type styles below still resolve on the button.
  return (
    <h1 className="text-[30px] sm:text-[32px] font-bold tracking-[-0.015em] leading-tight text-foreground group">
      <button
        type="button"
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        title="Click to rename"
        className="cursor-pointer rounded-[4px] text-left transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {name}
        <span className="ml-2 opacity-0 group-hover:opacity-60 text-body leading-5 align-middle transition-opacity">
          ✎
        </span>
      </button>
    </h1>
  )
}
