import type { SQL } from 'bun'

import type { Player } from '../types'
import type { RequestMeta } from './requestMeta'
import { orDisabledDefault, withHistoryStore } from './historyStore'
import { deleteResultVideo } from './engine'
import { persistFindings, type FindingRecord } from './findings'
import { persistPlayerEvents } from './registry'
import { uuidArrayLiteral } from './org/scope'
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
 *  query. Used via `db.unsafe(ANALYSES_SELECT_COLUMNS)` inside a select.
 *
 *  This is the FULL row, `summary_json` included, and it belongs to the
 *  single-row reads only — by id, by server job id, the `returning *` write, and
 *  the account export. A LIST must use `ANALYSES_LIST_COLUMNS` instead; see the
 *  note there for the size and the boundary reasons. */
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

/**
 * A LIST row's `summary_json`: `{"form_score": <number>}`, or SQL NULL.
 *
 * The blob is the whole reason this projection exists. `summary_json` carries
 * `shot_events[]` — each with `biomechanics.joint_angles`, `weighted_scoring.criteria[]`
 * and `injury_risk` — plus `findings[]`, `quality` and `top_tips`, measured at
 * 57.5 KB for 12 events and 95.6 KB at the engine's 20-event frame budget. Every
 * list consumer reads exactly one field of it (`summary_json.form_score`), so a
 * 21-row History page was moving ~2 MB of JSON to render 21 numbers.
 *
 * Three properties, each of which a "just cast `->>` to float8" version gets wrong:
 *
 *  1. **An unscored row stays NULL.** `jsonb_build_object('form_score', NULL)` is
 *     `{"form_score": null}` — an object that HAS the key, and every consumer
 *     gates on having it: the History score tile (`'form_score' in a.summary_json`)
 *     and `org/reports.ts`'s `analysesBlock`, whose `Number(summary.form_score)`
 *     turns a JSON null into **0**, printing 0/10 for an analysis that was never
 *     scored. The `case` keeps the NULL answer both for a NULL blob and for a blob
 *     with no numeric score — which is exactly what those gates already read.
 *
 *  2. **The cast is total.** `->>` is text, so `(…)::float8` raises 22P02 on
 *     anything non-numeric: ONE row whose `form_score` is the string "N/A" would
 *     turn the 21-row History page into a 500, where the unprojected blob simply
 *     rendered no score for it (the web requires `typeof score === 'number'`).
 *     The pattern admits only a decimal, so everything unmatched takes the NULL
 *     arm — the same answer the client used to compute for itself — and the
 *     length bound rules out the other failure the cast has, float8 overflow
 *     (22003) on a 300-digit integer. `org/performance.ts:220` still casts this
 *     column bare on the much narrower series read; that 22P02 is pre-existing and
 *     is deliberately not widened from here.
 *
 *  3. **It is a strict SUBSET, so the §5 medical boundary still fails closed.**
 *     `redactWellness` only ever REMOVES keys, so projecting one away before the
 *     read is strictly more restrictive than redacting after it — there is no
 *     caller, medical or not, that the projection could disclose to. The one list
 *     route that redacts at all is `GET /api/me/analyses`, and it redacts
 *     unconditionally ("Player scope never carries wellness signals"); its object
 *     here has no `shot_events` for `redactWellness` to walk, and `form_score` is
 *     not a wellness key. The single-row reads that carry the real medical
 *     decision (`resolveMedicalAccess` in routes/auth.ts, routes/status.ts,
 *     routes/share.ts, routes/email.ts) keep `ANALYSES_SELECT_COLUMNS`, untouched.
 *
 * The regex's character class is written `[.]`, not `\.`: the dot is escaped by
 * the brackets, so the pattern does not depend on `standard_conforming_strings`
 * (with it off, `'\.'` degrades to a bare `.` — "any character" — and the cast
 * would be reachable by `"1x2"`).
 */
export const ANALYSES_LIST_SUMMARY_JSON = `
  case
    when length(a.summary_json ->> 'form_score') <= 40
     and (a.summary_json ->> 'form_score') ~ '^-?[0-9]+([.][0-9]+)?$'
      then jsonb_build_object('form_score', (a.summary_json ->> 'form_score')::float8)
    else null
  end
`

/**
 * The LIST projection of `ANALYSES_SELECT_COLUMNS`: every column the list
 * consumers read, with `summary_json` replaced by `ANALYSES_LIST_SUMMARY_JSON`
 * under the SAME column name, so the row shape the client and the server already
 * agree on is unchanged and no consumer has to be taught a new field.
 *
 * Do not reach for this on a single-row read — the analysis detail page, the
 * share link, the chat/clips/download handlers, the `returning *` link write and
 * the account export all need the real blob, and they use
 * `ANALYSES_SELECT_COLUMNS`.
 */
export const ANALYSES_LIST_COLUMNS = `
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
  ${ANALYSES_LIST_SUMMARY_JSON} as summary_json,
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
        ${record.players ?? null}::jsonb,
        ${record.scanResponse ?? null}::jsonb,
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
  // Bound as the object, not JSON.stringify(...): Bun's prepared-statement path
  // stores the string form as a jsonb *string* (jsonb_typeof = 'string'), which
  // redactWellness then passes through untouched — so the medical redaction
  // silently stopped working on the persisted row.
  const summaryJson = record.status.summary ?? null
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
        ${record.status}::jsonb,
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
  // The batch form needs the ids as a Postgres array *literal*, built here and
  // bound as one parameter with an explicit ::text[] cast. Passing the JS array
  // straight through does not work: Bun serialises an array as comma-joined
  // text, and `any($1)` against a text column then infers text[] and dies with
  // `malformed array literal: "a,b"`. That made every retention run throw on its
  // first child table, so nothing was ever pruned — analyses, findings, clips,
  // player_events and chat_messages accumulated forever, and the feature
  // reported as healthy because the throw was logged once a day and `pruned`
  // never rose. Verified live against Neon on both a prepared and an unprepared
  // connection. `retention.test.ts` only covers the pure retentionDays() clamp,
  // and no fixture can catch this: they stub `db` as a plain tag function.
  const batchLiteral = many ? `{${(serverJobIds as string[]).join(',')}}` : null
  for (const table of ANALYSIS_CHILD_TABLES) {
    if (batchLiteral !== null) {
      await db.unsafe(`delete from ${table} where server_job_id = any($1::text[]);`, [batchLiteral])
    } else {
      await db.unsafe(`delete from ${table} where server_job_id = $1;`, [serverJobIds])
    }
  }
}

export const deleteAnalysis = async (auth0Id: string, serverJobId: string): Promise<boolean> => {
  const engineJobId = await withHistoryStore(async (db) => {
    const owned = await db<{ server_job_id: string; engine_job_id: string | null }[]>`
      select server_job_id, engine_job_id from analysis_history
      where auth0_id = ${auth0Id} and server_job_id = ${serverJobId}
      limit 1;
    `
    return owned?.[0] ?? null
  })
  if (!engineJobId) return false
  const res = await withHistoryStore(async (db) => {
    const owned = await db<{ server_job_id: string }[]>`
      select server_job_id from analysis_history
      where auth0_id = ${auth0Id} and server_job_id = ${serverJobId}
      limit 1;
    `
    if (!owned?.[0]) return false
    await deleteAnalysisChildren(db, serverJobId)
    return true
  })
  const deleted = orDisabledDefault(res, false)
  // Storage follows the rows: without this the rendered mp4 orphans forever
  // (raw uploads die with session eviction, results do not).
  if (deleted && engineJobId.engine_job_id) {
    await deleteResultVideo(engineJobId.engine_job_id)
  }
  return deleted
}

/** Daily per-org analysis cap (§17). */

export const orgDailyAnalysisLimit = (): number => {
  const raw = Number(process.env.ORG_DAILY_ANALYSIS_LIMIT ?? 50)
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 10000) : 50
}

export type UsageReservation = { total: number } | { capped: true } | null

/**
 * Atomically reserve `quantity` units of today's usage ledger for an org.
 * Counter-row upsert plus a guarded increment: the UPDATE's row lock
 * serializes concurrent admissions (the waiter re-evaluates
 * `total + quantity <= limit` on the committed row — the standard Postgres
 * atomic-counter pattern, correct under READ COMMITTED). The old
 * check-then-act (count history rows, admit, insert usage later)
 * over-admitted under burst concurrency; a single aggregate check could
 * NOT fix it (statement snapshots go stale the same way, and fused
 * data-modifying CTEs cannot see each other's effects — hence two
 * statements, not one).
 *
 * Returns the post-reserve total, `{ capped: true }` when the cap is
 * already reached (counter unmoved), or null when the store is
 * unavailable — callers fail OPEN on null per the no-DB policy (the
 * wrapper already logged the outage).
 */
export const tryReserveUsage = async (
  orgAuth0Id: string,
  kind: string,
  limit: number,
  quantity = 1,
): Promise<UsageReservation> => {
  const kindKey = kind.slice(0, 60)
  return withHistoryStore(async (db) => {
    // Two statements, deliberately NOT fused into one CTE: data-modifying
    // CTEs share a snapshot and cannot see each other's effects, so a fused
    // upsert+guarded-increment would miss a freshly inserted counter row
    // and falsely report capped on every first reserve of the day. As
    // separate statements the guarded UPDATE serializes concurrent
    // admissions on the counter row lock (the waiter re-evaluates
    // `total + quantity <= limit` on the committed row).
    await db`
      insert into usage_counters (org_auth0_id, kind, period_day, total)
      values (${orgAuth0Id}, ${kindKey}, current_date, 0)
      on conflict (org_auth0_id, kind, period_day) do nothing;
    `
    const rows = await db<{ total: number }[]>`
      update usage_counters as c set total = c.total + ${quantity},
        updated_at = now()
      where c.org_auth0_id = ${orgAuth0Id}
        and c.kind = ${kindKey}
        and c.period_day = current_date
        and c.total + ${quantity} <= ${limit}
      returning c.total;
    `
    if (!rows || rows.length === 0) return { capped: true }
    return { total: rows[0].total }
  })
}

/** Seconds until midnight UTC (quota retry-after). */
export const secondsUntilMidnightUtc = (now = Date.now()): number => {
  const midnightUtc = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  )
  return Math.max(1, Math.ceil((midnightUtc - now) / 1000))
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

/** Usage totals per kind since midnight UTC (status views; the gate reads usage_counters). */

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
 *
 * The same run also sweeps bounded auxiliary tables: consumed/expired
 * invites, aged notifications, and stages orphaned by deleted jobs. Audit
 * rows are deliberately NOT pruned here — they outlive analyses by design
 * (who-did-what must survive what-they-did-to), and any audit retention
 * belongs to an explicit, separately-reviewed policy, not a daily sweep.
 */
export type RetentionPruneCounts = {
  analyses: number
  resultVideos: number
  invites: number
  notifications: number
  stages: number
}

export const pruneRetention = async (): Promise<number> => {
  const report = await pruneRetentionReport()
  return report?.analyses ?? 0
}

export const pruneRetentionReport = async (): Promise<RetentionPruneCounts | null> => {
  const days = retentionDays()
  return withHistoryStore(async (db) => {
    const stale =
      (await db<{ server_job_id: string; engine_job_id: string | null }[]>`
      select server_job_id, engine_job_id from analysis_history
      where requested_at < now() - (${days} || ' days')::interval;
    `) ?? []
    const counts: RetentionPruneCounts = {
      analyses: 0,
      resultVideos: 0,
      invites: 0,
      notifications: 0,
      stages: 0,
    }
    if (stale.length > 0) {
      const ids = stale.map((r) => r.server_job_id)
      await deleteAnalysisChildren(db, ids)
      counts.analyses = ids.length
      // Storage follows the rows: rendered mp4s orphan otherwise.
      for (const row of stale) {
        if (row.engine_job_id) {
          const { deleted } = await deleteResultVideo(row.engine_job_id)
          if (deleted) counts.resultVideos += 1
        }
      }
    }
    // Single-use tokens have no value after use, expiry, or revocation: a
    // consumed row that lingers only widens the lookup the accept path scans.
    const invites = await db<{ id: string }[]>`
      delete from org_invites
      where accepted_at is not null
        or revoked_at is not null
        or expires_at < now() - interval '7 days'
      returning id;
    `
    counts.invites = invites?.length ?? 0
    const notifications = await db<{ id: string }[]>`
      delete from notifications
      where created_at < now() - (${days} || ' days')::interval
      returning id;
    `
    counts.notifications = notifications?.length ?? 0
    const stages = await db<{ id: string }[]>`
      delete from analysis_stages
      where server_job_id not in (select server_job_id from analysis_history)
      returning id;
    `
    counts.stages = stages?.length ?? 0
    return counts
  })
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

/**
 * The account tree's analysis LIST.
 *
 * Projected, not full: see `ANALYSES_LIST_SUMMARY_JSON`. Note the §5 boundary
 * does NOT live here — `GET /api/auth/user/:auth0Id/analyses` hands these rows
 * straight back, so the projection is what keeps wellness out of a list response
 * for a caller who has no medical role. The one list route that *does* redact is
 * `GET /api/me/analyses` (routes/me.ts), which redacts unconditionally and is
 * strictly better off for it.
 */
export const getUserAnalyses = async (
  auth0Id: string,
  limit = 20,
  offset = 0,
  opts: { unlinked?: boolean; studentIds?: string[] | null } = {},
): Promise<DashboardAnalysis[]> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      // Rows here are owned by the *org* (the account id in this path is the
      // org's own sub), so an unfiltered read is org-wide. A scoped caller gets
      // their own students plus their own unlinked rows: an analysis with no
      // student is nobody else's player, and dropping those would hide a coach's
      // own unfiled uploads from their History page.
      //
      // The clause is parameterised rather than spliced as text for two reasons,
      // both learned the hard way: a raw JS array binds as comma-joined text and
      // `::uuid[]` then fails with 22P02, and a literal interpolated into
      // `db.unsafe` loses its braces (`syntax error at or near "{"`). So the id
      // list is a real bind and `scoped` gates the whole clause in one shape.
      // `null` means org-wide and adds no filter; `[]` degrades to unlinked only.
      const scoped = opts.studentIds !== null && opts.studentIds !== undefined
      const ids = uuidArrayLiteral(opts.studentIds ?? [])
      const unlinkedFilter = opts.unlinked ? 'and a.student_id is null' : ''
      // The list projection, not the full row: this feeds the History page, the
      // dashboard's Recents and the student's linked/unlinked analysis lists, and
      // every one of them reads `summary_json.form_score` and nothing else inside
      // it (see ANALYSES_LIST_SUMMARY_JSON for the size and the boundary notes).
      const rows = await db<DashboardAnalysis[]>`
      select ${db.unsafe(ANALYSES_LIST_COLUMNS)}
      from analysis_history a
      left join video_conversations v on a.session_token = v.session_token
      where a.auth0_id = ${auth0Id}
        ${db.unsafe(unlinkedFilter)}
        and (${scoped} = false
             or a.student_id is null
             or a.student_id = any(${ids}::uuid[]))
      order by a.requested_at desc
      limit ${limit} offset ${offset};
    `
      return rows ?? []
    }),
    [],
  )
}

/**
 * The student a stored analysis is about, for the account tree's job-keyed
 * scope check.
 *
 * Returned as an explicit `found` flag rather than a nullable id because a
 * `null` student is a real answer (an upload nobody filed under a player) and
 * `orDisabledDefault` would absorb it into the disabled-store fallback, turning
 * "this analysis has no student" into "no such analysis" and 404ing a coach's
 * own unfiled upload.
 */
export const getAnalysisStudentId = async (
  auth0Id: string,
  serverJobId: string,
): Promise<{ found: boolean; studentId: string | null }> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const rows = await db<{ student_id: string | null }[]>`
        select a.student_id
        from analysis_history a
        where a.auth0_id = ${auth0Id} and a.server_job_id = ${serverJobId}
        limit 1;
      `
      const row = rows?.[0]
      if (!row) return { found: false, studentId: null }
      return { found: true, studentId: row.student_id ?? null }
    }),
    { found: false, studentId: null },
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

/**
 * Counts for the dashboard's stat tiles.
 *
 * `studentIds` mirrors `getUserAnalyses`: rows here are owned by the org, so an
 * unfiltered count is org-wide, and the tiles sit directly above the History list
 * — a coach whose tile read "20" beside a three-row list looked like a bug. The
 * clause and its bound-parameter handling are the same as the list's, unlinked
 * rows included, so a coach's own unfiled uploads still count toward their own
 * total.
 */
export const getUserStats = async (
  auth0Id: string,
  opts: { studentIds?: string[] | null } = {},
): Promise<DashboardStats> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const scoped = opts.studentIds !== null && opts.studentIds !== undefined
      const ids = uuidArrayLiteral(opts.studentIds ?? [])
      const rows = await db<DashboardStats[]>`
      select
        count(*)::int as total_analyses,
        count(*) filter (where complete = true)::int as completed_analyses,
        count(*) filter (where complete = false and error_code is null)::int as in_progress_analyses,
        count(*) filter (where error_code is not null)::int as failed_analyses,
        coalesce(sum(download_count), 0)::int as total_downloads
      from analysis_history
      where auth0_id = ${auth0Id}
        and (${scoped} = false
             or student_id is null
             or student_id = any(${ids}::uuid[]));
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
