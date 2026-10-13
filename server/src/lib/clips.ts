import { ensureInitialized, withHistoryStore } from './historyStore'
import { CLIP_ID_RE, parseClipInput, type ClipInput } from './clipsPolicy'

// ── Clips (subclip bookmarks) ───────────────────────────────────────────────
// A clip is a coach-curated time range on an analysis's rendered video:
// label + [start_ms, end_ms], optionally linked to the finding that motivated
// it. No video bytes are duplicated — playback seeks the rendered video.
// Scoped to accounts via the analysis_history join (same as findings).
//
// Pure curation rules (caps, input validation) live in ./clipsPolicy and are
// re-exported below so existing importers keep working during migration.
export {
  CLIP_ID_RE,
  MAX_CLIP_DURATION_MS,
  MAX_CLIPS_PER_ANALYSIS,
  parseClipInput,
  type CleanedClipInput,
  type ClipInput,
} from './clipsPolicy'

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
  // One transaction: the ownership check, the finding-match check, and the
  // insert run on a single connection, so a concurrent delete cannot slip
  // an orphan clip between the checks and the write.
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      return db.begin(async (tx) => {
        // The analysis must belong to the caller's account — no cross-account clips.
        const owned = await tx<{ server_job_id: string }[]>`
          select server_job_id from analysis_history
          where auth0_id = ${auth0Id} and server_job_id = ${serverJobId} limit 1;
        `
        if (!owned?.[0]) return null
        // An attached finding must belong to the same analysis.
        if (parsed.cleaned.finding_id) {
          const match = await tx<{ id: string }[]>`
            select id from findings
            where server_job_id = ${serverJobId} and id = ${parsed.cleaned.finding_id} limit 1;
          `
          if (!match?.[0]) return null
        }
        const rows = await tx<ClipRecord[]>`
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
      })
    })) ?? null
  )
}

/** Delete a clip. Returns false when it does not belong to the account. */
export const deleteClip = async (
  auth0Id: string,
  serverJobId: string,
  clipId: string,
): Promise<boolean> => {
  if (!CLIP_ID_RE.test(clipId)) return false
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
