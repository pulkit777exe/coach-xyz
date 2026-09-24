import type { SQL } from 'bun'

import type { Player } from '../types'
import type { RequestMeta } from './requestMeta'
import { orDisabledDefault, withHistoryStore } from './historyStore'
import { persistFindings, type FindingRecord } from './findings'
import { persistPlayerEvents } from './registry'
type VideoConversationRecord = RequestMeta & {
  sessionToken: string
  fileName: string
  fileMimeType: string
  fileSizeBytes: number
  playerCount: number
  players: Player[]
  scanResponse: Record<string, unknown>
  auth0Id?: string | null
}

type AnalysisStartRecord = RequestMeta & {
  serverJobId: string
  engineJobId: string
  sessionToken: string | null
  playerIndex: number | null
  model: string
  auth0Id?: string | null
  /** Auth0 id of whoever kicked off the job (e.g. a linked player). */
  requestedBy?: string | null
  /** Linked student row — scopes the job to a player's record. */
  studentId?: string | null
}

type AnalysisStatusRecord = {
  serverJobId: string
  engineJobId: string
  sessionToken: string | null
  playerIndex: number | null
  model: string
  requestedBy?: string | null
  status: {
    stage: number
    stage_name: string
    progress: number
    complete: boolean
    video_ready: boolean
    summary: unknown
    error: string | null
    error_code: string | null
    retryable: boolean
  }
}

/** Shared column list for the analysis_history + video_conversations dashboard

/** Shared column list for the analysis_history + video_conversations dashboard
 *  query. Used via `db.unsafe(ANALYSES_SELECT_COLUMNS)` inside a select. */
export const ANALYSES_SELECT_COLUMNS = `
  a.server_job_id,
  a.auth0_id,
  a.engine_job_id,
  a.session_token,
  a.player_index,
  a.model,
  a.stage,
  a.stage_name,
  a.progress,
  a.complete,
  a.video_ready,
  a.summary_json,
  a.error_code,
  a.error_message,
  a.requested_at,
  a.completed_at,
  a.download_count,
  a.display_name,
  a.requested_by,
  a.student_id,
  v.file_name,
  v.file_size_bytes,
  v.player_count
`

const supabaseProjectUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim() || null
const supabasePublishableKey =
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '').trim() || null

export const persistVideoConversation = async (record: VideoConversationRecord): Promise<void> => {
  await withHistoryStore(async (db) => {
    await db`
      insert into video_conversations (
        session_token,
        file_name,
        file_mime_type,
        file_size_bytes,
        player_count,
        players_json,
        scan_response_json,
        client_ip,
        user_agent,
        supabase_project_url,
        auth0_id,
        updated_at
      ) values (
        ${record.sessionToken},
        ${record.fileName},
        ${record.fileMimeType},
        ${record.fileSizeBytes},
        ${record.playerCount},
        ${JSON.stringify(record.players)}::jsonb,
        ${JSON.stringify(record.scanResponse)}::jsonb,
        ${record.clientIp},
        ${record.userAgent},
        ${supabaseProjectUrl},
        ${record.auth0Id || null},
        now()
      )
      on conflict (session_token) do update set
        file_name = excluded.file_name,
        file_mime_type = excluded.file_mime_type,
        file_size_bytes = excluded.file_size_bytes,
        player_count = excluded.player_count,
        players_json = excluded.players_json,
        scan_response_json = excluded.scan_response_json,
        client_ip = excluded.client_ip,
        user_agent = excluded.user_agent,
        supabase_project_url = excluded.supabase_project_url,
        auth0_id = coalesce(excluded.auth0_id, video_conversations.auth0_id),
        updated_at = now();
    `
  })
}

export const persistAnalysisStart = async (record: AnalysisStartRecord): Promise<void> => {
  await withHistoryStore(async (db) => {
    await db`
      insert into analysis_history (
        server_job_id,
        engine_job_id,
        session_token,
        player_index,
        model,
        client_ip,
        user_agent,
        supabase_project_url,
        supabase_publishable_key,
        auth0_id,
        requested_by,
        student_id,
        updated_at
      ) values (
        ${record.serverJobId},
        ${record.engineJobId},
        ${record.sessionToken},
        ${record.playerIndex},
        ${record.model},
        ${record.clientIp},
        ${record.userAgent},
        ${supabaseProjectUrl},
        ${supabasePublishableKey},
        ${record.auth0Id || null},
        ${record.requestedBy || null},
        ${record.studentId ?? null}::uuid,
        now()
      )
      on conflict (server_job_id) do update set
        engine_job_id = excluded.engine_job_id,
        session_token = excluded.session_token,
        player_index = excluded.player_index,
        model = excluded.model,
        client_ip = excluded.client_ip,
        user_agent = excluded.user_agent,
        supabase_project_url = excluded.supabase_project_url,
        supabase_publishable_key = excluded.supabase_publishable_key,
        auth0_id = coalesce(excluded.auth0_id, analysis_history.auth0_id),
        requested_by = coalesce(analysis_history.requested_by, excluded.requested_by),
        student_id = coalesce(analysis_history.student_id, excluded.student_id),
        updated_at = now();
    `
  })
}

export const persistAnalysisStatus = async (record: AnalysisStatusRecord): Promise<void> => {
  const summaryJson = record.status.summary ? JSON.stringify(record.status.summary) : null
  const errorCode = record.status.error_code ?? (record.status.error ? 'ANALYSIS_FAILED' : null)
  const completedAt = record.status.complete ? new Date().toISOString() : null

  await withHistoryStore(async (db) => {
    // A cancelled analysis stays cancelled: late worker completions must not
    // resurrect it (cancellation is an explicit terminal state).
    const existing = await db<{ complete: boolean; error_code: string | null }[]>`
      select complete, error_code from analysis_history
      where server_job_id = ${record.serverJobId}
      limit 1;
    `
    if (existing?.[0]?.complete && existing[0].error_code === 'ANALYSIS_CANCELLED') {
      await db`
        update analysis_history set last_polled_at = now()
        where server_job_id = ${record.serverJobId};
      `
      return
    }
    await db`
      insert into analysis_history (
        server_job_id,
        engine_job_id,
        session_token,
        player_index,
        model,
        stage,
        stage_name,
        progress,
        complete,
        video_ready,
        summary_json,
        status_json,
        error_code,
        error_message,
        requested_by,
        last_polled_at,
        completed_at,
        updated_at
      ) values (
        ${record.serverJobId},
        ${record.engineJobId},
        ${record.sessionToken},
        ${record.playerIndex},
        ${record.model},
        ${record.status.stage},
        ${record.status.stage_name},
        ${record.status.progress},
        ${record.status.complete},
        ${record.status.video_ready},
        ${summaryJson}::jsonb,
        ${JSON.stringify(record.status)}::jsonb,
        ${errorCode},
        ${record.status.error},
        ${record.requestedBy || null},
        now(),
        ${completedAt},
        now()
      )
      on conflict (server_job_id) do update set
        engine_job_id = excluded.engine_job_id,
        session_token = coalesce(analysis_history.session_token, excluded.session_token),
        player_index = coalesce(analysis_history.player_index, excluded.player_index),
        model = coalesce(analysis_history.model, excluded.model),
        stage = excluded.stage,
        stage_name = excluded.stage_name,
        progress = excluded.progress,
        complete = excluded.complete,
        video_ready = excluded.video_ready,
        summary_json = excluded.summary_json,
        status_json = excluded.status_json,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        requested_by = coalesce(analysis_history.requested_by, excluded.requested_by),
        last_polled_at = now(),
        completed_at = coalesce(analysis_history.completed_at, excluded.completed_at),
        updated_at = now();
    `
  })

  // Findings are final only on completion — persist them once (replace any
  // prior rows for idempotency across the worker + poll double-persist).
  const summary = record.status.summary as {
    findings?: unknown
    shot_events?: unknown
  } | null
  if (record.status.complete && Array.isArray(summary?.findings)) {
    await persistFindings(record.serverJobId, summary.findings as FindingRecord[])
    // Materialize the event timeline for trend queries (§26).
    const owner = await getAnalysisOwner(record.serverJobId)
    await persistPlayerEvents(
      record.serverJobId,
      owner?.auth0_id ?? null,
      owner?.student_id ?? null,
      Array.isArray(summary?.shot_events)
        ? (summary?.shot_events as Array<Record<string, unknown>>)
        : [],
    )
  }

  // Internal stage history (§13): append only on transition, not per poll.
  await withHistoryStore(async (db) => {
    const last = await db<{ stage: number | null }[]>`
      select stage from analysis_stages
      where server_job_id = ${record.serverJobId}
      order by created_at desc limit 1;
    `
    if (!last?.[0] || last[0].stage !== record.status.stage) {
      await db`
        insert into analysis_stages (server_job_id, stage, stage_name)
        values (${record.serverJobId}, ${record.status.stage}, ${record.status.stage_name});
      `
    }
  })
}

/** The five child tables of an analysis, deleted in this exact order —
 * derived rows first so no orphans survive the history delete. Shared by
 * deleteAnalysis (one job) and pruneRetention (batch); only the WHERE clause
 * (`= $1` vs `any($1)`) differs between the two callers. */
const ANALYSIS_CHILD_TABLES = [
  'findings',
  'clips',
  'player_events',
  'chat_messages',
  'analysis_history',
] as const

const deleteAnalysisChildren = async (db: SQL, serverJobIds: string | string[]): Promise<void> => {
  const many = Array.isArray(serverJobIds)
  for (const table of ANALYSIS_CHILD_TABLES) {
    await db.unsafe(
      many
        ? `delete from ${table} where server_job_id = any($1);`
        : `delete from ${table} where server_job_id = $1;`,
      [serverJobIds],
    )
  }
}

export const deleteAnalysis = async (auth0Id: string, serverJobId: string): Promise<boolean> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const owned = await db<{ server_job_id: string }[]>`
      select server_job_id from analysis_history
      where auth0_id = ${auth0Id} and server_job_id = ${serverJobId}
      limit 1;
    `
      if (!owned?.[0]) return false
      await deleteAnalysisChildren(db, serverJobId)
      return true
    }),
    false,
  )
}

/** Daily per-org analysis cap (§17 precursor). */

export const orgDailyAnalysisLimit = (): number => {
  const raw = Number(process.env.ORG_DAILY_ANALYSIS_LIMIT ?? 50)
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 10000) : 50
}

/** Analyses started by this org since midnight UTC. Fail-open without a DB. */

export const countTodayOrgAnalyses = async (orgAuth0Id: string): Promise<number | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<{ count: number }[]>`
      select count(*)::int as count from analysis_history
      where auth0_id = ${orgAuth0Id}
        and requested_at >= date_trunc('day', now());
    `
    return rows?.[0]?.count ?? 0
  })
}

/** Daily per-org quota verdict. Fail-open without org identity or DB. */ export const checkOrgDailyQuota =
  async (orgAuth0Id: string | null): Promise<{ allowed: boolean; retryAfterSec: number }> => {
    if (!orgAuth0Id) return { allowed: true, retryAfterSec: 0 }
    const count = await countTodayOrgAnalyses(orgAuth0Id)
    if (count === null || count < orgDailyAnalysisLimit()) {
      return { allowed: true, retryAfterSec: 0 }
    }
    const now = Date.now()
    const midnightUtc = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1,
    )
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((midnightUtc - now) / 1000)),
    }
  }

export type OrgTier = 'free' | 'pro' | 'elite'

/** Org tier (default free). Quotas and queue priority derive from this. */

export const getOrgTier = async (orgAuth0Id: string): Promise<OrgTier> => {
  const tier = await withHistoryStore(async (db) => {
    const rows = await db<{ tier: OrgTier }[]>`
      insert into subscriptions (org_auth0_id) values (${orgAuth0Id})
      on conflict (org_auth0_id) do nothing
      returning tier;
    `
    if (rows?.[0]) return rows[0].tier
    const existing = await db<{ tier: OrgTier }[]>`
      select tier from subscriptions where org_auth0_id = ${orgAuth0Id} limit 1;
    `
    return existing?.[0]?.tier ?? 'free'
  })
  return orDisabledDefault(tier, 'free')
}

/** Append to the org usage ledger (§17 quotas, future billing). */

export const recordUsage = async (
  orgAuth0Id: string,
  kind: string,
  quantity = 1,
): Promise<void> => {
  await withHistoryStore(async (db) => {
    await db`
      insert into usage_records (org_auth0_id, kind, quantity)
      values (${orgAuth0Id}, ${kind.slice(0, 60)}, ${quantity});
    `
  })
}

/** Usage totals per kind since midnight UTC (for quota + status views). */

export const getTodayUsage = async (orgAuth0Id: string): Promise<Record<string, number>> => {
  const rows = orDisabledDefault(
    await withHistoryStore(async (db) => {
      return (
        (await db<{ kind: string; total: number }[]>`
      select kind, sum(quantity)::int as total from usage_records
      where org_auth0_id = ${orgAuth0Id} and period_day = current_date
      group by kind;
    `) ?? []
      )
    }),
    [],
  )
  return Object.fromEntries(rows.map((r) => [r.kind, r.total]))
}

/** Retention window for analysis artifacts (days). */

export const retentionDays = (): number => {
  const raw = Number(process.env.RETENTION_DAYS ?? 365)
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 30), 3650) : 365
}

/**
 * Delete analyses (plus findings + chat) older than the retention window.
 * Derived rows go first so no orphans survive the history delete. Returns
 * the number of analyses pruned.
 */

export const pruneRetention = async (): Promise<number> => {
  const days = retentionDays()
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const stale = await db<{ server_job_id: string }[]>`
      select server_job_id from analysis_history
      where requested_at < now() - (${days} || ' days')::interval;
    `
      if (!stale?.length) return 0
      const ids = stale.map((r) => r.server_job_id)
      await deleteAnalysisChildren(db, ids)
      return ids.length
    }),
    0,
  )
}

export const markAnalysisDownloaded = async (serverJobId: string): Promise<void> => {
  await withHistoryStore(async (db) => {
    await db`
      update analysis_history
      set
        download_count = download_count + 1,
        last_downloaded_at = now(),
        updated_at = now()
      where server_job_id = ${serverJobId};
    `
  })
}

export const updateAnalysisDisplayName = async (
  auth0Id: string,
  serverJobId: string,
  displayName: string,
): Promise<DashboardAnalysis | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<DashboardAnalysis[]>`
      update analysis_history
      set display_name = ${displayName || null}, updated_at = now()
      where server_job_id = ${serverJobId}
        and auth0_id = ${auth0Id}
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const linkAnalysisToStudent = async (
  auth0Id: string,
  serverJobId: string,
  studentId: string | null,
): Promise<DashboardAnalysis | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<DashboardAnalysis[]>`
      update analysis_history
      set student_id = ${studentId ?? null}, updated_at = now()
      where server_job_id = ${serverJobId}
        and auth0_id = ${auth0Id}
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export type DashboardAnalysis = {
  server_job_id: string
  auth0_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  model: string
  stage: number | null
  stage_name: string | null
  progress: number | null
  complete: boolean
  video_ready: boolean
  summary_json: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
  requested_at: string
  completed_at: string | null
  download_count: number
  display_name: string | null
  requested_by: string | null
  file_name: string | null
  file_size_bytes: number | null
  player_count: number | null
  student_id: string | null
}

export type DashboardStats = {
  total_analyses: number
  completed_analyses: number
  in_progress_analyses: number
  failed_analyses: number
  total_downloads: number
}

export const getUserAnalyses = async (
  auth0Id: string,
  limit = 20,
  offset = 0,
  opts: { unlinked?: boolean } = {},
): Promise<DashboardAnalysis[]> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const unlinkedFilter = opts.unlinked ? 'and a.student_id is null' : ''
      const rows = await db<DashboardAnalysis[]>`
      select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
      from analysis_history a
      left join video_conversations v on a.session_token = v.session_token
      where a.auth0_id = ${auth0Id}
        ${db.unsafe(unlinkedFilter)}
      order by a.requested_at desc
      limit ${limit} offset ${offset};
    `
      return rows ?? []
    }),
    [],
  )
}

export const getUserAnalysisById = async (
  auth0Id: string,
  serverJobId: string,
): Promise<DashboardAnalysis | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<DashboardAnalysis[]>`
      select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
      from analysis_history a
      left join video_conversations v on a.session_token = v.session_token
      where a.auth0_id = ${auth0Id} and a.server_job_id = ${serverJobId}
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const getAnalysisByServerJobId = async (
  serverJobId: string,
): Promise<DashboardAnalysis | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<DashboardAnalysis[]>`
      select ${db.unsafe(ANALYSES_SELECT_COLUMNS)}
      from analysis_history a
      left join video_conversations v on a.session_token = v.session_token
      where a.server_job_id = ${serverJobId}
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

/** Owner + requested-by + student for a job, without the heavy summary payload.
/// Used on hot paths (status polls, event materialization). */
export const getAnalysisOwner = async (
  serverJobId: string,
): Promise<{
  auth0_id: string | null
  requested_by: string | null
  student_id: string | null
} | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<
      {
        auth0_id: string | null
        requested_by: string | null
        student_id: string | null
      }[]
    >`
      select auth0_id, requested_by, student_id from analysis_history
      where server_job_id = ${serverJobId}
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const getUserStats = async (auth0Id: string): Promise<DashboardStats> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const rows = await db<DashboardStats[]>`
      select
        count(*)::int as total_analyses,
        count(*) filter (where complete = true)::int as completed_analyses,
        count(*) filter (where complete = false and error_code is null)::int as in_progress_analyses,
        count(*) filter (where error_code is not null)::int as failed_analyses,
        coalesce(sum(download_count), 0)::int as total_downloads
      from analysis_history
      where auth0_id = ${auth0Id};
    `
      return (
        rows?.[0] ?? {
          total_analyses: 0,
          completed_analyses: 0,
          in_progress_analyses: 0,
          failed_analyses: 0,
          total_downloads: 0,
        }
      )
    }),
    {
      total_analyses: 0,
      completed_analyses: 0,
      in_progress_analyses: 0,
      failed_analyses: 0,
      total_downloads: 0,
    },
  )
}
