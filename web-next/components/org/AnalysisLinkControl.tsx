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
 *
 * Two independent pieces of data: `linkedId` comes from the analysis row (a prop) and
 * `students` comes from the org roster. A failed roster read used to set `students` to
 * `[]`, which took the WHOLE control with it — including the "Linked to X" chip on an
 * analysis that is linked, and with it the Unlink action, which needs no roster at all.
 * So a transient org-read outage made an existing link invisible AND unremovable.
 * Renders nothing only while the roster is still loading, or when there is neither a
 * link to show nor a roster to offer.
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
  // Whether the roster READ failed, as distinct from a roster that loaded and is
  // empty. The two used to be the same `[]`.
  const [rosterFailed, setRosterFailed] = useState(false)
  const [linkedId, setLinkedId] = useState<string | null>(initialStudentId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    orgStudents(auth0Id)
      .then((res) => {
        if (!cancelled) {
          setStudents(res.students)
          setRosterFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStudents([])
          setRosterFailed(true)
        }
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
    // Still loading — nothing is being claimed yet, so there is nothing to correct.
    return null
  }
  // The linked state lives on the analysis row (`linkedId`), not in the roster. So a
  // roster that failed to load — or came back empty — must not remove the chip on an
  // analysis that IS linked, nor with it the Unlink action, which needs no roster.
  // What disappears is the ability to CHOOSE a student, and that is stated in the panel
  // rather than silently rendered as an empty list.
  if (students.length === 0 && linkedId === null) {
    return null
  }

  const linkedStudent = students.find((s) => s.id === linkedId) ?? null
  // True whenever the ANALYSIS row names a student, which is independent of whether the
  // roster resolved that id to a name. Naming is therefore gated on the roster; the fact
  // of the link is not.
  const hasLink = linkedId !== null

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
        className={`flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
          hasLink
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
        {/* The name comes from the roster; the LINK does not. When the roster could not be
            read we say "Linked" rather than falling back to UNLINKED_LABEL, which
            would tell the coach an already-linked analysis is unlinked. */}
        {linkedStudent ? linkedStudent.full_name : hasLink ? 'Linked' : UNLINKED_LABEL}
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
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-[6px] border border-border bg-popover shadow-lg dark:shadow-none">
          <div className="border-b border-border px-4 py-2 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {linkedStudent ? 'Linked to' : hasLink ? 'Linked' : 'Choose a student'}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {hasLink && (
              <button
                type="button"
                onClick={() => applyLink(null)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-meta text-destructive hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {linkedStudent ? `Unlink ${linkedStudent.full_name}` : 'Unlink'}
              </button>
            )}
            {/* The roster read is a separate fact from the link. An empty list here with
                no explanation reads as "you have no students", which is a claim about
                the org, not about this page's read. */}
            {rosterFailed ? (
              // `hasLink` is always true here and is NOT branched on: `rosterFailed`
              // implies `students === []`, and the early return above drops the
              // component unless a link exists, so this is the only reachable shape.
              <p className="px-4 py-2.5 text-meta leading-[1.5] text-muted-foreground">
                The student roster failed to load, so no other students can be listed here. You can
                still unlink this analysis.
              </p>
            ) : students.length === 0 ? (
              // The read SUCCEEDED and returned nothing, while the analysis still names a
              // student. Stated rather than left as a bare "Unlink" row, because the
              // missing name is otherwise unexplained.
              <p className="px-4 py-2.5 text-meta leading-[1.5] text-muted-foreground">
                This analysis is linked, but the roster returned no students, so the name cannot be
                shown here.
              </p>
            ) : null}
            {students.map((s) => {
              const isLinked = s.id === linkedId
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={isLinked}
                  onClick={() => applyLink(s.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-body text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-disabled"
                >
                  <span className="truncate">{s.full_name}</span>
                  <span className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
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
