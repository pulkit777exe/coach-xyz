'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { Student } from '@/lib/org'
import { orgStudents, linkAnalysisToStudent } from '@/lib/org'
import type { CoachAIError } from '@/lib/api'

const UNLINKED_LABEL = 'Link to Student'

/**
 * Analysis ↔ Student linking from the analysis detail view.
 * Calls the auth PATCH endpoint so the analysis row gains a student_id.
 * Renders nothing when the org data connection is unavailable.
 */
export default function AnalysisLinkControl({
  auth0Id,
  jobId,
  initialStudentId,
}: {
  auth0Id: string
  jobId: string
  initialStudentId: string | null
}) {
  const [students, setStudents] = useState<Student[] | null>(null)
  const [linkedId, setLinkedId] = useState<string | null>(initialStudentId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    orgStudents(auth0Id)
      .then((res) => {
        if (!cancelled) setStudents(res.students)
      })
      .catch(() => {
        if (!cancelled) setStudents([])
      })
    return () => {
      cancelled = true
    }
  }, [auth0Id])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  if (students === null) {
    return null
  }
  if (students.length === 0) {
    return null
  }

  const linkedStudent = students.find((s) => s.id === linkedId) ?? null

  const applyLink = async (studentId: string | null) => {
    if (busy) return
    setBusy(true)
    try {
      await linkAnalysisToStudent(auth0Id, jobId, studentId)
      setLinkedId(studentId)
      setOpen(false)
      toast.success(studentId ? 'Analysis linked to student' : 'Analysis unlinked')
    } catch (err) {
      toast.error((err as CoachAIError).message ?? 'Failed to update student link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
          linkedStudent
            ? 'border-transparent bg-success/10 text-success'
            : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title="Attach this analysis to a student for tracking"
      >
        <svg
          className="size-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {linkedStudent ? linkedStudent.full_name : UNLINKED_LABEL}
        <svg
          className="size-3 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-[6px] border border-border bg-popover shadow-lg">
          <div className="border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {linkedStudent ? 'Linked to' : 'Choose a student'}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {linkedStudent && (
              <button
                type="button"
                onClick={() => applyLink(null)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-[13px] text-destructive hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                Unlink {linkedStudent.full_name}
              </button>
            )}
            {students.map((s) => {
              const isLinked = s.id === linkedId
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={isLinked}
                  onClick={() => applyLink(s.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px] text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50"
                >
                  <span className="truncate">{s.full_name}</span>
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {s.sport || ''}
                    {isLinked ? ' · linked' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
