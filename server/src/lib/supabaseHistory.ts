import { SQL } from "bun"

import type { Player } from "../types"
import type { RequestMeta } from "./requestMeta"

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
}

type AnalysisStatusRecord = {
  serverJobId: string
  engineJobId: string
  sessionToken: string | null
  playerIndex: number | null
  model: string
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

const databaseUrl = (process.env.DATABASE_URL ?? "").trim()
const supabaseProjectUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() || null
const supabasePublishableKey =
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "").trim() || null

const sql = databaseUrl
  ? new SQL(databaseUrl, {
      idleTimeout: 300,
      max: 5,
    })
  : null

let initPromise: Promise<void> | null = null
let warnedDisabled = false

const isEnabled = (): boolean => sql !== null

const warnDisabled = () => {
  if (warnedDisabled) return
  warnedDisabled = true
  console.warn(
    "Supabase history storage is disabled because DATABASE_URL is not set.",
  )
}

const withHistoryStore = async <T>(fn: (db: SQL) => Promise<T>): Promise<T | null> => {
  if (!sql) {
    warnDisabled()
    return null
  }

  try {
    return await fn(sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error"

    if (message.includes("Connection closed")) {
      console.warn("Supabase connection was closed, reconnecting…")
      initPromise = null
      try {
        await ensureInitialized()
        return await fn(sql)
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : "Unknown database error"
        console.error("Supabase history operation failed after retry:", retryMessage)
        return null
      }
    }

    console.error("Supabase history operation failed:", message)
    return null
  }
}

const ensureInitialized = async () => {
  if (!sql) return

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await sql.connect()
        await sql`
        create table if not exists video_conversations (
          session_token text primary key,
          file_name text not null,
          file_mime_type text not null,
          file_size_bytes bigint not null,
          player_count integer not null,
          players_json jsonb not null default '[]'::jsonb,
          scan_response_json jsonb not null default '{}'::jsonb,
          client_ip text,
          user_agent text,
          source text not null default 'web-next',
          supabase_project_url text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
      `

      await sql`
        create table if not exists analysis_history (
          server_job_id text primary key,
          engine_job_id text not null,
          session_token text,
          player_index integer,
          model text not null,
          stage integer,
          stage_name text,
          progress integer,
          complete boolean not null default false,
          video_ready boolean not null default false,
          summary_json jsonb,
          status_json jsonb,
          error_code text,
          error_message text,
          client_ip text,
          user_agent text,
          source text not null default 'web-next',
          supabase_project_url text,
          supabase_publishable_key text,
          requested_at timestamptz not null default now(),
          last_polled_at timestamptz,
          completed_at timestamptz,
          last_downloaded_at timestamptz,
          download_count integer not null default 0,
          updated_at timestamptz not null default now()
        );
      `

      await sql`
        create index if not exists idx_video_conversations_created_at
        on video_conversations (created_at desc);
      `
      await sql`
        create index if not exists idx_analysis_history_requested_at
        on analysis_history (requested_at desc);
      `
      await sql`
        create index if not exists idx_analysis_history_session_token
        on analysis_history (session_token);
      `

      await sql`
        create table if not exists users (
          id uuid primary key default gen_random_uuid(),
          auth0_id text unique not null,
          email text,
          name text,
          nickname text,
          picture text,
          email_verified boolean default false,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
      `
      await sql`
        create index if not exists idx_users_auth0_id
        on users (auth0_id);
      `
      await sql`
        create index if not exists idx_users_email
        on users (email);
      `

      // Add auth0_id columns to existing tables (idempotent)
      await sql`ALTER TABLE video_conversations ADD COLUMN IF NOT EXISTS auth0_id text;`
      await sql`ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS auth0_id text;`
      await sql`CREATE INDEX IF NOT EXISTS idx_video_conversations_auth0_id ON video_conversations (auth0_id);`
      await sql`CREATE INDEX IF NOT EXISTS idx_analysis_history_auth0_id ON analysis_history (auth0_id);`
      } catch (err) {
        // Reset so next call retries initialization
        initPromise = null
        throw err
      }
    })()
  }

  await initPromise
}

export const initializeHistoryStore = async (): Promise<void> => {
  await withHistoryStore(async () => {
    await ensureInitialized()
  })
}

export const persistVideoConversation = async (
  record: VideoConversationRecord,
): Promise<void> => {
  await withHistoryStore(async (db) => {
    await ensureInitialized()
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
    await ensureInitialized()
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
        updated_at = now();
    `
  })
}

export const persistAnalysisStatus = async (record: AnalysisStatusRecord): Promise<void> => {
  const summaryJson = record.status.summary
    ? JSON.stringify(record.status.summary)
    : null
  const errorCode = record.status.error_code ?? (record.status.error ? "ANALYSIS_FAILED" : null)
  const completedAt = record.status.complete ? new Date().toISOString() : null

  await withHistoryStore(async (db) => {
    await ensureInitialized()
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
        last_polled_at = now(),
        completed_at = coalesce(analysis_history.completed_at, excluded.completed_at),
        updated_at = now();
    `
  })
}

export const markAnalysisDownloaded = async (serverJobId: string): Promise<void> => {
  await withHistoryStore(async (db) => {
    await ensureInitialized()
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

export const historyStoreEnabled = isEnabled

export const shutdownHistoryStore = async (): Promise<void> => {
  if (sql) await sql.close()
}

// ── User Management ─────────────────────────────────────────────────────────

export type UserRecord = {
  id: string
  auth0_id: string
  email: string | null
  name: string | null
  nickname: string | null
  picture: string | null
  email_verified: boolean
  created_at: string
  updated_at: string
}

export const upsertUser = async (user: {
  sub: string
  email?: string
  name?: string
  nickname?: string
  picture?: string
  email_verified?: boolean
}): Promise<UserRecord | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<UserRecord[]>`
      insert into users (auth0_id, email, name, nickname, picture, email_verified)
      values (${user.sub}, ${user.email || null}, ${user.name || null}, ${user.nickname || null}, ${user.picture || null}, ${user.email_verified || false})
      on conflict (auth0_id) do update set
        email = excluded.email,
        name = excluded.name,
        nickname = excluded.nickname,
        picture = excluded.picture,
        email_verified = excluded.email_verified,
        updated_at = now()
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const getUserByAuth0Id = async (auth0Id: string): Promise<UserRecord | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<UserRecord[]>`
      select * from users where auth0_id = ${auth0Id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

// ── Dashboard Queries ───────────────────────────────────────────────────────

export type DashboardAnalysis = {
  server_job_id: string
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
  file_name: string | null
  file_size_bytes: number | null
  player_count: number | null
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
): Promise<DashboardAnalysis[]> => {
  return (await withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<DashboardAnalysis[]>`
      select
        a.server_job_id,
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
        v.file_name,
        v.file_size_bytes,
        v.player_count
      from analysis_history a
      left join video_conversations v on a.session_token = v.session_token
      where a.auth0_id = ${auth0Id}
      order by a.requested_at desc
      limit ${limit} offset ${offset};
    `
    return rows ?? []
  })) ?? []
}

export const getUserAnalysisById = async (
  auth0Id: string,
  serverJobId: string,
): Promise<DashboardAnalysis | null> => {
  return withHistoryStore(async (db) => {
    await ensureInitialized()
    const rows = await db<DashboardAnalysis[]>`
      select
        a.server_job_id,
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
        v.file_name,
        v.file_size_bytes,
        v.player_count
      from analysis_history a
      left join video_conversations v on a.session_token = v.session_token
      where a.auth0_id = ${auth0Id} and a.server_job_id = ${serverJobId}
      limit 1;
    `
    return rows?.[0] ?? null
  })
}

export const getUserStats = async (auth0Id: string): Promise<DashboardStats> => {
  return (await withHistoryStore(async (db) => {
    await ensureInitialized()
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
    return rows?.[0] ?? {
      total_analyses: 0,
      completed_analyses: 0,
      in_progress_analyses: 0,
      failed_analyses: 0,
      total_downloads: 0,
    }
  })) ?? {
    total_analyses: 0,
    completed_analyses: 0,
    in_progress_analyses: 0,
    failed_analyses: 0,
    total_downloads: 0,
  }
}
