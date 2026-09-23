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

  return (
    <h1
      onClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      className="text-[30px] sm:text-[32px] font-bold tracking-[-0.015em] leading-tight text-foreground cursor-pointer hover:text-muted-foreground transition-colors group"
      title="Click to rename"
    >
      {name}
      <span className="ml-2 opacity-0 group-hover:opacity-60 text-sm align-middle transition-opacity">✎</span>
    </h1>
  )
}
