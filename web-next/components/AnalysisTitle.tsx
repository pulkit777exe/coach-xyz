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
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(name); setEditing(false) }
        }}
        className="font-serif text-4xl leading-none text-(--fg) bg-transparent border-b border-(--cream-20) w-full focus:outline-none sm:text-5xl"
      />
    )
  }

  return (
    <h1
      onClick={() => { setDraft(name); setEditing(true) }}
      className="font-serif text-4xl leading-none text-(--fg) cursor-pointer hover:opacity-70 group sm:text-5xl"
      title="Click to rename"
    >
      {name}
      <span className="ml-2 opacity-0 group-hover:opacity-50 text-sm align-middle">✎</span>
    </h1>
  )
}
