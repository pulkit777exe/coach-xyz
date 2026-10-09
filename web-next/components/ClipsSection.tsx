'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import { Input } from '@/components/9ui/ui/input'
import { Label } from '@/components/9ui/ui/label'
import TimestampPill from '@/components/TimestampPill'
import { createClip, deleteClip, listClips, type Clip } from '@/lib/api'
import { Spinner } from '@/components/org/Spinner'

interface ClipsSectionProps {
  auth0Id: string | null
  jobId: string
  onSeek: (seconds: number) => void
}

function formatRange(startMs: number, endMs: number): string {
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000))
  return `${seconds}s`
}

export default function ClipsSection({ auth0Id, jobId, onSeek }: ClipsSectionProps) {
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)
  // The existing `loading` flag already separated "still reading" from "read", so this is
  // the only half that was missing: a rejected read collapsed to `[]`, which is the same
  // value a genuinely empty clip list holds. The heading counts the clips, so a coach
  // with saved clips read "Clips (0)" — a fabricated count, and an invitation to re-mark
  // ranges they had already saved.
  const [failed, setFailed] = useState(false)
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const mountedRef = useRef(false)
  // Signed out is a THIRD state, not "empty". The anonymous flow (`app/page.tsx` renders
  // `ChatLayout` with a falsy `scopeId`) reaches this section with `auth0Id` null, the
  // early return below skips the read, and for years the section then rendered
  // "Clips (0)" over "No clips yet — mark a time range to revisit it instantly": a
  // fabricated count plus an invitation to save clips there is no account to save them
  // to (the Save form is gated on `auth0Id`, so it was absent — the instruction pointed
  // at a control that was not on screen). `jobId` is React state here, lost on sign-in,
  // so the honest copy promises no persistence either.
  const signedOut = auth0Id === null

  const refresh = useCallback(async () => {
    if (!auth0Id) {
      setLoading(false)
      return
    }
    const seq = ++requestSeq.current
    try {
      const res = await listClips(auth0Id, jobId)
      if (requestSeq.current === seq) {
        setClips(res.clips)
        setFailed(false)
      }
    } catch {
      if (requestSeq.current === seq) {
        setFailed(true)
        setClips([])
      }
    } finally {
      if (requestSeq.current === seq) setLoading(false)
    }
  }, [auth0Id, jobId])

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    void refresh()
  }, [refresh])

  const submit = async () => {
    if (!auth0Id) {
      toast.error('Sign in to save clips')
      return
    }
    const startMs = Math.floor(Number(start) * 1000)
    const endMs = Math.floor(Number(end) * 1000)
    if (!label.trim() || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      toast.error('Label, start, and end are required')
      return
    }
    setBusy(true)
    try {
      const res = await createClip(auth0Id, jobId, {
        label: label.trim(),
        start_ms: startMs,
        end_ms: endMs,
      })
      setClips((prev) => [res.clip, ...prev])
      setLabel('')
      setStart('')
      setEnd('')
      toast.success('Clip saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save clip')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (clip: Clip) => {
    if (!auth0Id) return
    setDeletingId(clip.id)
    try {
      await deleteClip(auth0Id, jobId, clip.id)
      setClips((prev) => prev.filter((c) => c.id !== clip.id))
      toast.success('Clip deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete clip')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {/* The count is a claim about this analysis's saved clips. While the read is in
            flight — or has failed — there is no claim to make. Note this heading sits
            OUTSIDE the `loading` branch below, so it used to print a confident 0 during
            loading as well as after a failure. Signed out is the same absence of a claim:
            no read happened, so no count. */}
        Clips
        {loading ? null : failed ? (
          <span> · unavailable</span>
        ) : signedOut ? null : (
          <>
            {' ('}
            <span className="tabular-nums">{clips.length}</span>
            {')'}
          </>
        )}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : (
        <>
          {failed ? (
            // "No clips yet — mark a time range to revisit it instantly." is an
            // instruction to act on data we do not have: a coach with saved clips would
            // re-mark the same ranges and duplicate them.
            <p className="py-2 text-meta text-muted-foreground">
              Clips failed to load. This is a loading problem, not an empty list — reload to
              retry.
            </p>
          ) : signedOut ? (
            // Signed out: no read was attempted, so neither the failed copy nor the empty
            // copy is true. The empty copy would promise persistence this session cannot
            // deliver, and the heading must not print a count for a list nobody fetched.
            <p className="py-2 text-meta text-muted-foreground">
              Clips are not available in this view.
            </p>
          ) : clips.length === 0 ? (
            <p className="py-2 text-meta text-muted-foreground">
              No clips yet — mark a time range to revisit it instantly.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {clips.map((clip) => (
                <li
                  key={clip.id}
                  className="group flex items-center gap-2 rounded-[4px] px-2 py-1.5 hover:bg-accent transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onSeek(clip.start_ms / 1000)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    aria-label={`Play clip ${clip.label}`}
                  >
                    <PlayIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    <span className="truncate text-meta font-medium text-foreground">
                      {clip.label}
                    </span>
                    <TimestampPill seconds={clip.start_ms / 1000} />
                    <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                      {formatRange(clip.start_ms, clip.end_ms)}
                    </span>
                  </button>
                  {auth0Id &&
                    (deletingId === clip.id ? (
                      <Spinner className="shrink-0 text-muted-foreground" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete clip ${clip.label}`}
                        onClick={() => void remove(clip)}
                      >
                        <Trash2Icon />
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          )}

          {auth0Id && (
            <div className="mt-3 grid grid-cols-[1fr_64px_64px_auto] items-end gap-2">
              <div className="grid gap-1">
                <Label
                  htmlFor="clip-label"
                  className="text-label font-medium text-muted-foreground"
                >
                  Label
                </Label>
                <Input
                  id="clip-label"
                  className="h-8 text-meta"
                  placeholder="Release sequence"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label
                  htmlFor="clip-start"
                  className="text-label font-medium text-muted-foreground"
                >
                  Start (s)
                </Label>
                <Input
                  id="clip-start"
                  type="number"
                  min="0"
                  step="0.1"
                  className="h-8 text-meta tabular-nums"
                  placeholder="12.5"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="clip-end" className="text-label font-medium text-muted-foreground">
                  End (s)
                </Label>
                <Input
                  id="clip-end"
                  type="number"
                  min="0"
                  step="0.1"
                  className="h-8 text-meta tabular-nums"
                  placeholder="15.0"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
              <Button size="sm" className="h-8" onClick={submit} disabled={busy}>
                {busy ? <Spinner /> : <PlusIcon />}
                Save
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
