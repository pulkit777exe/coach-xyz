import { SQL } from 'bun'

import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
} from './orgEnums'
import { USER_ROLES } from './userRoles'
const databaseUrl = (process.env.DATABASE_URL ?? '').trim()

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
    JSON.stringify({
      type: 'history_store_disabled',
      message: 'DATABASE_URL not set',
    }),
  )
}

export const withHistoryStore = async <T>(fn: (db: SQL) => Promise<T>): Promise<T | null> => {
  if (!sql) {
    warnDisabled()
    return null
  }

  try {
    return await fn(sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error'

    if (message.includes('Connection closed')) {
      console.warn(JSON.stringify({ type: 'history_store_reconnecting' }))
      initPromise = null
      try {
        await ensureInitialized()
        return await fn(sql)
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : 'Unknown database error'
        console.error(
          JSON.stringify({
            type: 'history_store_retry_failed',
            error: retryMessage,
          }),
        )
        return null
      }
    }

    console.error(
      JSON.stringify({
        type: 'history_store_operation_failed',
        error: message,
      }),
    )
    return null
  }
}

export const withHistoryStoreOrThrow = async <T>(fn: (db: SQL) => Promise<T>): Promise<T> => {
  if (!sql) {
    warnDisabled()
    throw new Error('History store is not configured (DATABASE_URL not set)')
  }

  try {
    return await fn(sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error'

    if (message.includes('Connection closed')) {
      console.warn(JSON.stringify({ type: 'history_store_reconnecting' }))
      initPromise = null
      try {
        await ensureInitialized()
        return await fn(sql)
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : 'Unknown database error'
        console.error(
          JSON.stringify({
            type: 'history_store_retry_failed',
            error: retryMessage,
          }),
        )
        throw retryError
      }
    }

    console.error(
      JSON.stringify({
        type: 'history_store_operation_failed',
        error: message,
      }),
    )
    throw error
  }
}

export const ensureInitialized = async () => {
  if (!sql) return

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await sql.connect()
        const inList = (vals: readonly string[]) =>
          sql.unsafe(`(${vals.map((v) => `'${v}'`).join(',')})`)
        // Level: tables without foreign keys — independent, run together.
        await Promise.all([
          (async () => {
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
          })(),
          (async () => {
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
            display_name text,
            requested_by text,
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists findings (
            id text not null,
            server_job_id text not null,
            category text not null,
            start_ms bigint,
            end_ms bigint,
            confidence double precision,
            confidence_band text,
            severity text,
            observation text,
            feedback text,
            form_score double precision,
            evidence_frames jsonb not null default '[]'::jsonb,
            measured_at_timestamp double precision,
            model_versions jsonb not null default '{}'::jsonb,
            review_state text not null default 'auto',
            created_at timestamptz not null default now(),
            constraint findings_unique unique (server_job_id, id)
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists training_objectives (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            student_id uuid,
            team_id uuid,
            finding_id text,
            analysis_job_id text,
            title text not null,
            description text,
            status text not null default 'active'
              check (status in ('active', 'done', 'archived')),
            due_on date,
            created_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists seasons (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            name text not null,
            starts_on date,
            ends_on date,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists matches (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            team_id uuid,
            season_id uuid,
            opponent text,
            match_on date,
            location text,
            result text,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists training_plans (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            team_id uuid,
            student_id uuid,
            title text not null,
            description text,
            status text not null default 'active'
              check (status in ('active', 'done', 'archived')),
            created_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists wellness_checkins (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            student_id uuid not null,
            sleep_hours double precision,
            fatigue integer check (fatigue is null or (fatigue >= 1 and fatigue <= 5)),
            pain text,
            availability text,
            note text,
            created_by text,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists subscriptions (
            org_auth0_id text primary key,
            tier text not null default 'free'
              check (tier in ('free', 'pro', 'elite')),
            status text not null default 'active',
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists usage_records (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            kind text not null,
            quantity integer not null default 1,
            period_day date not null default current_date,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists analysis_stages (
            id uuid primary key default gen_random_uuid(),
            server_job_id text not null,
            stage integer,
            stage_name text,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists audit_logs (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            actor_auth0_id text,
            action text not null,
            resource_type text not null,
            resource_id text,
            result text,
            meta jsonb not null default '{}'::jsonb,
            client_ip text,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists users (
            id uuid primary key default gen_random_uuid(),
            auth0_id text unique not null,
            email text,
            name text,
            nickname text,
            picture text,
            email_verified boolean default false,
            linked_auth0_ids text[] default '{}',
            role text not null default 'coach'
              constraint users_role_check check (role in ${inList(USER_ROLES)}),
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists chat_messages (
            id uuid primary key default gen_random_uuid(),
            server_job_id text not null,
            auth0_id text not null,
            role text not null check (role in ('user', 'assistant', 'system')),
            content text not null,
            timestamp_refs jsonb,
            event_refs jsonb,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists students (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            full_name text not null,
            email text,
            phone text,
            sport text,
            "position" text,
            jersey_number integer,
            date_of_birth date,
            gender text,
            guardian_name text,
            guardian_phone text,
            notes text,
            status text not null default 'active'
              check (status in ${inList(STUDENT_STATUSES)}),
            joined_on date,
            account_auth0_id text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists schedule_events (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            title text not null,
            event_type text not null default 'practice'
              check (event_type in ${inList(EVENT_TYPES)}),
            starts_at timestamptz not null,
            ends_at timestamptz,
            location text,
            description text,
            status text not null default 'scheduled'
              check (status in ${inList(EVENT_STATUSES)}),
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
        ])
        // Level: tables referencing students — independent, run together.
        await Promise.all([
          (async () => {
  await sql`
          create table if not exists attendance (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            student_id uuid not null references students(id) on delete cascade,
            session_date date not null,
            status text not null
              check (status in ${inList(ATTENDANCE_STATUSES)}),
            note text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            constraint attendance_auth0_student_session_unique
              unique (auth0_id, student_id, session_date)
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists reports (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            student_id uuid references students(id) on delete set null,
            report_type text not null default 'progress'
              check (report_type in ${inList(REPORT_TYPES)}),
            title text not null,
            period_start date,
            period_end date,
            content_json jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
  await sql`
          create table if not exists performance_metrics (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            student_id uuid not null references students(id) on delete cascade,
            metric_key text not null,
            metric_value numeric not null,
            unit text,
            source_analysis_id text,
            measured_at timestamptz not null default now(),
            created_at timestamptz not null default now(),
            constraint performance_auth0_student_metric_unique
              unique (auth0_id, student_id, metric_key, measured_at)
          );
        `
          })(),
        ])
        // Level: indexes, columns, and idempotent migrations — independent, run together.
        await Promise.all([
          (async () => {
  await sql`
          create index if not exists idx_video_conversations_created_at
          on video_conversations (created_at desc);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_analysis_history_requested_at
          on analysis_history (requested_at desc);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_analysis_history_session_token
          on analysis_history (session_token);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_findings_server_job_id
          on findings (server_job_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_findings_created_at
          on findings (created_at desc);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_objectives_org_student
          on training_objectives (org_auth0_id, student_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_wellness_org_student
          on wellness_checkins (org_auth0_id, student_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_usage_org_day
          on usage_records (org_auth0_id, period_day);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_stages_job
          on analysis_stages (server_job_id, created_at);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_audit_logs_org_created
          on audit_logs (org_auth0_id, created_at desc);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_users_auth0_id
          on users (auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_users_email
          on users (email);
        `
          })(),
          (async () => {
  await sql`alter table users add column if not exists role text not null default 'coach';`
          })(),
          (async () => {
  await sql`
          do $$
          begin
            if not exists (
              select 1 from pg_constraint where conname = 'users_role_check'
            ) then
              alter table users add constraint users_role_check
                check (role in ${inList(USER_ROLES)});
            end if;
          end $$;
        `
          })(),
          (async () => {
  await sql`ALTER TABLE video_conversations ADD COLUMN IF NOT EXISTS auth0_id text;`
          })(),
          (async () => {
  await sql`ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS auth0_id text;`
          })(),
          (async () => {
  await sql`CREATE INDEX IF NOT EXISTS idx_video_conversations_auth0_id ON video_conversations (auth0_id);`
          })(),
          (async () => {
  await sql`CREATE INDEX IF NOT EXISTS idx_analysis_history_auth0_id ON analysis_history (auth0_id);`
          })(),
          (async () => {
  await sql`alter table analysis_history add column if not exists display_name text;`
          })(),
          (async () => {
  await sql`alter table analysis_history add column if not exists requested_by text;`
          })(),
          (async () => {
  await sql`alter table users add column if not exists linked_auth0_ids text[] default '{}';`
          })(),
          (async () => {
  await sql`
          create index if not exists idx_chat_messages_server_job_id
          on chat_messages (server_job_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_chat_messages_auth0_id
          on chat_messages (auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_students_auth0_id
          on students (auth0_id);
        `
          })(),
          (async () => {
  await sql`alter table students add column if not exists account_auth0_id text;`
          })(),
          (async () => {
  await sql`
          create index if not exists idx_students_account_auth0_id
          on students (account_auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_attendance_auth0_id
          on attendance (auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_attendance_session_date
          on attendance (session_date);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_schedule_auth0_id
          on schedule_events (auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_schedule_starts_at
          on schedule_events (starts_at);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_reports_auth0_id
          on reports (auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_reports_student_id
          on reports (student_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_perf_auth0_id
          on performance_metrics (auth0_id);
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_perf_student
          on performance_metrics (student_id, metric_key, measured_at desc);
        `
          })(),
          (async () => {
  await sql`
          do $$
          begin
            if not exists (
              select 1 from pg_constraint
              where conname = 'attendance_auth0_student_session_unique'
            ) then
              alter table attendance add constraint attendance_auth0_student_session_unique
                unique (auth0_id, student_id, session_date);
            end if;
            alter table attendance drop constraint if exists attendance_student_id_session_date_key;
          end $$
        `
          })(),
          (async () => {
  await sql`
          do $$
          begin
            if not exists (
              select 1 from pg_constraint
              where conname = 'performance_auth0_student_metric_unique'
            ) then
              alter table performance_metrics add constraint performance_auth0_student_metric_unique
                unique (auth0_id, student_id, metric_key, measured_at);
            end if;
            alter table performance_metrics drop constraint if exists performance_metrics_student_id_metric_key_measured_at_key;
          end $$
        `
          })(),
          (async () => {
  await sql`
          alter table analysis_history add column if not exists student_id uuid;
        `
          })(),
          (async () => {
  await sql`
          create index if not exists idx_analysis_history_student_id
          on analysis_history (student_id);
        `
          })(),
        ])
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

export const historyStoreEnabled = isEnabled

export const shutdownHistoryStore = async (): Promise<void> => {
  if (sql) await sql.close()
}
