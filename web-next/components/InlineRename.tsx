'use client'

import { useState, useRef, useEffect } from 'react'

export default function InlineRename({
  value,
  onSave,
  className = '',
}: {
  value: string
  onSave: (newName: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const save = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== value) {
      onSave(trimmed)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={`bg-transparent border border-border px-2 py-0.5 text-inherit font-inherit focus:outline-none ${className}`}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:opacity-70 group ${className}`}
      title="Click to rename"
    >
      {value || 'Untitled'}
      <span className="ml-1 opacity-0 group-hover:opacity-50 text-xs">✎</span>
    </span>
  )
}
