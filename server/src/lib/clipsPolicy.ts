// ── Clips policy (pure) ──────────────────────────────────────────────────────
// Pure curation rules for subclip bookmarks: caps, input validation, id
// shape. No I/O — unit-testable without infra. The persistence seam stays
// in ./clips (scoped CRUD); it imports these, and re-exports them so
// existing importers keep working.

export const MAX_CLIP_DURATION_MS = 120_000
export const MAX_CLIPS_PER_ANALYSIS = 100

export type ClipInput = {
  label?: unknown
  start_ms?: unknown
  end_ms?: unknown
  finding_id?: unknown
}

export type CleanedClipInput = {
  label: string
  start_ms: number
  end_ms: number
  finding_id: string | null
}

export const CLIP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure validator for clip creation. Returns the cleaned row or a reason. */
export const parseClipInput = (
  input: ClipInput,
): { ok: true; cleaned: CleanedClipInput } | { ok: false; reason: string } => {
  const start =
    typeof input.start_ms === 'number' && Number.isFinite(input.start_ms)
      ? Math.floor(input.start_ms)
      : NaN
  const end =
    typeof input.end_ms === 'number' && Number.isFinite(input.end_ms)
      ? Math.floor(input.end_ms)
      : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, reason: 'start_ms and end_ms must be finite numbers' }
  }
  if (start < 0 || end < 0) return { ok: false, reason: 'clip bounds must be >= 0' }
  if (end <= start) return { ok: false, reason: 'end_ms must be after start_ms' }
  if (end - start > MAX_CLIP_DURATION_MS) {
    return { ok: false, reason: `clips are capped at ${MAX_CLIP_DURATION_MS / 1000}s` }
  }
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 120) : ''
  if (!label) return { ok: false, reason: 'label is required' }
  const findingId =
    typeof input.finding_id === 'string' && input.finding_id.trim()
      ? input.finding_id.trim().slice(0, 200)
      : null
  return { ok: true, cleaned: { label, start_ms: start, end_ms: end, finding_id: findingId } }
}
