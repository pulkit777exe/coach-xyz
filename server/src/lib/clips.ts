import { ensureInitialized, withHistoryStore } from './historyStore'

// ── Clips (subclip bookmarks) ───────────────────────────────────────────────
// A clip is a coach-curated time range on an analysis's rendered video:
// label + [start_ms, end_ms], optionally linked to the finding that motivated
// it. No video bytes are duplicated — playback seeks the rendered video.
// Scoped to accounts via the analysis_history join (same as findings).

export const MAX_CLIP_DURATION_MS = 120_000
export const MAX_CLIPS_PER_ANALYSIS = 100

export type ClipRecord = {
  id: string
  server_job_id: string
  finding_id: string | null
  label: string
  start_ms: number
  end_ms: number
  created_by: string | null
  created_at: string
}

export type ClipInput = {
  label?: unknown
  start_ms?: unknown
  end_ms?: unknown
  finding_id?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pure validator for clip creation. Returns the cleaned row or a reason. */
export const parseClipInput = (
  input: ClipInput,
): { ok: true; cleaned: { label: string; start_ms: number; end_ms: number; finding_id: string | null } } | { ok: false; reason: string } => {
  const start = typeof input.start_ms === 'number' && Number.isFinite(input.start_ms) ? Math.floor(input.start_ms) : NaN
  const end = typeof input.end_ms === 'number' && Number.isFinite(input.end_ms) ? Math.floor(input.end_ms) : NaN
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
    typeof input.finding_id === 'string' && input.finding_id.trim() ? input.finding_id.trim().slice(0, 200) : null
  return { ok: true, cleaned: { label, start_ms: start, end_ms: end, finding_id: findingId } }
}

/** List an analysis's clips (newest first). Scoped by the caller's account. */
export const listClips = async (auth0Id: string, serverJobId: string): Promise<ClipRecord[]> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<ClipRecord[]>`
        select c.id, c.server_job_id, c.finding_id, c.label,
          c.start_ms, c.end_ms, c.created_by, c.created_at
        from clips c
        join analysis_history a on a.server_job_id = c.server_job_id
        where a.auth0_id = ${auth0Id} and c.server_job_id = ${serverJobId}
        order by c.created_at desc;
      `
      return rows ?? []
    })) ?? []
  )
}

/** Count an analysis's clips (cap enforcement). */
export const countClips = async (auth0Id: string, serverJobId: string): Promise<number> => {
  const rows = await withHistoryStore(async (db) => {
    await ensureInitialized()
    return db<{ n: number }[]>`
      select count(*)::int as n from clips c
      join analysis_history a on a.server_job_id = c.server_job_id
      where a.auth0_id = ${auth0Id} and c.server_job_id = ${serverJobId};
    `
  })
  return rows?.[0]?.n ?? 0
}

export const createClip = async (
  auth0Id: string,
  serverJobId: string,
  input: ClipInput,
  createdBy: string | null,
): Promise<ClipRecord | null> => {
  const parsed = parseClipInput(input)
  if (!parsed.ok) return null
  // The analysis must belong to the caller's account — no cross-account clips.
  const owned = await withHistoryStore(async (db) => {
    await ensureInitialized()
    return db<{ server_job_id: string }[]>`
      select server_job_id from analysis_history
      where auth0_id = ${auth0Id} and server_job_id = ${serverJobId} limit 1;
    `
  })
  if (!owned?.[0]) return null
  // An attached finding must belong to the same analysis.
  if (parsed.cleaned.finding_id) {
    const match = await withHistoryStore(async (db) => {
      await ensureInitialized()
      return db<{ id: string }[]>`
        select id from findings
        where server_job_id = ${serverJobId} and id = ${parsed.cleaned.finding_id} limit 1;
      `
    })
    if (!match?.[0]) return null
  }
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<ClipRecord[]>`
        insert into clips (server_job_id, finding_id, label, start_ms, end_ms, created_by)
        values (
          ${serverJobId},
          ${parsed.cleaned.finding_id},
          ${parsed.cleaned.label},
          ${parsed.cleaned.start_ms},
          ${parsed.cleaned.end_ms},
          ${createdBy}
        )
        returning id, server_job_id, finding_id, label, start_ms, end_ms, created_by, created_at;
      `
      return rows?.[0] ?? null
    })) ?? null
  )
}

/** Delete a clip. Returns false when it does not belong to the account. */
export const deleteClip = async (
  auth0Id: string,
  serverJobId: string,
  clipId: string,
): Promise<boolean> => {
  if (!UUID_RE.test(clipId)) return false
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ id: string }[]>`
        delete from clips c
        using analysis_history a
        where c.server_job_id = a.server_job_id
          and a.auth0_id = ${auth0Id}
          and c.server_job_id = ${serverJobId}
          and c.id = ${clipId}::uuid
        returning c.id;
      `
      return Boolean(rows?.[0])
    })) ?? false
  )
}
