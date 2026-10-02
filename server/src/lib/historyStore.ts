import { SQL } from 'bun'

import {
  ATTENDANCE_STATUSES,
  EVENT_STATUSES,
  EVENT_TYPES,
  REPORT_TYPES,
  STUDENT_STATUSES,
} from './orgEnums'
import { USER_ROLES } from './userRoles'
import { logger } from './logger'
const databaseUrl = (process.env.DATABASE_URL ?? '').trim()

// `let` (not `const`) solely so the test seam below can swap a stub connection
// in/out; production code assigns it exactly once, here.
let sql: SQL | null = databaseUrl
  ? new SQL(databaseUrl, {
      idleTimeout: 300,
      max: 5,
    })
  : null

let initPromise: Promise<void> | null = null
let warnedDisabled = false

const isEnabled = (): boolean => sql !== null

// Connection-level failures worth one reconnect + retry. Bun.SQL surfaces
// them as PostgresError.code in the ERR_POSTGRES_CONNECTION_* family
// (verified against the runtime: *_CLOSED / *_FAILED / *_REFUSED /
// *_TIMEOUT, plus idle/lifetime timeouts), and the Postgres server itself
// reports restarts and broken connections as 57P01/57P02/57P03 and
// 08000/08003/08006. Query errors (constraint violations, syntax, …)
// carry statement codes and must NEVER retry here — callbacks are not
// all idempotent, so a blind retry could double-apply a write that
// already landed.
const CONNECTION_ERROR_CODES = new Set([
  'ERR_POSTGRES_CONNECTION_CLOSED',
  'ERR_POSTGRES_CONNECTION_FAILED',
  'ERR_POSTGRES_CONNECTION_REFUSED',
  'ERR_POSTGRES_CONNECTION_TIMEOUT',
  'ERR_POSTGRES_IDLE_TIMEOUT',
  'ERR_POSTGRES_LIFETIME_TIMEOUT',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08003',
  '08006',
])

/**
 * True when a query failure means the connection died (retry once on a
 * fresh init) as opposed to the statement failing (surface immediately).
 * Prefers the machine-readable code; falls back to a case-insensitive
 * message sniff for foreign pool/driver errors without codes. The old
 * `message.includes('Connection closed')` check was case- and
 * driver-fragile — e.g. Bun reports timeouts as
 * ERR_POSTGRES_CONNECTION_TIMEOUT / 'Connection timeout after 3s',
 * which the old check never matched.
 */
export const isConnectionError = (error: unknown): boolean => {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'string') {
    if (CONNECTION_ERROR_CODES.has(code)) return true
    // A known code that is NOT a connection code (query-statement codes,
    // auth/cancelled/timeout statement errors) — never retry.
    if (code.startsWith('ERR_POSTGRES_') || /^[0-9A-Z]{5}$/.test(code)) return false
  }
  const message = error instanceof Error ? error.message : String(error)
  return /connection (closed|terminated|reset|refused|lost|timeout)|terminat|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EPIPE/i.test(
    message,
  )
}

const warnDisabled = () => {
  if (warnedDisabled) return
  warnedDisabled = true
  logger.warn('history_store_disabled', {
    type: 'history_store_disabled',
    detail: 'DATABASE_URL not set',
  })
}

/**
 * Shared implementation behind `withHistoryStore` / `withHistoryStoreOrThrow`.
 * The two exports differ ONLY in failure policy: the first swallows failures
 * (`null` when the store is disabled or a query fails), the second surfaces
 * them. Both own the module's core invariant: the schema is initialized
 * BEFORE the callback runs — callbacks must not re-run init themselves.
 */
const runWithHistoryStore = async <T>(
  fn: (db: SQL) => Promise<T>,
  throwOnFailure: boolean,
): Promise<T | null> => {
  if (!sql) {
    warnDisabled()
    if (throwOnFailure) throw new Error('History store is not configured (DATABASE_URL not set)')
    return null
  }

  try {
    // Schema-before-callback guarantee. ensureInitialized is idempotent
    // (shared initPromise), so a second concurrent caller awaits the same run.
    await ensureInitialized()
    return await fn(sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error'

    if (isConnectionError(error)) {
      logger.warn('history_store_reconnecting', { type: 'history_store_reconnecting' })
      initPromise = null
      try {
        await ensureInitialized()
        return await fn(sql)
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : 'Unknown database error'
        logger.error('history_store_retry_failed', {
          type: 'history_store_retry_failed',
          error: retryMessage,
        })
        if (throwOnFailure) throw retryError
        return null
      }
    }

    logger.error('history_store_operation_failed', {
      type: 'history_store_operation_failed',
      error: message,
    })
    if (throwOnFailure) throw error
    return null
  }
}

export const withHistoryStore = <T>(fn: (db: SQL) => Promise<T>): Promise<T | null> =>
  runWithHistoryStore(fn, false)

export const withHistoryStoreOrThrow = <T>(fn: (db: SQL) => Promise<T>): Promise<T> =>
  runWithHistoryStore(fn, true) as Promise<T>

/**
 * Degradation policy — the ONE place it is stated.
 *
 * `withHistoryStore` yields `null` when the store is disabled (DATABASE_URL
 * unset) or a query fails. Data functions must not leak that sentinel to
 * callers, so they surface a neutral default instead:
 *
 *   return orDisabledDefault(await withHistoryStore(async (db) => …), [])
 *
 * Use it only where the default exists BECAUSE the store can be absent —
 * `?? null` / `?? 0` on optional row fields *inside* a callback is unrelated
 * optional-value handling and stays as written. Callers of
 * `withHistoryStoreOrThrow` never see a disabled-null (it throws), so they
 * have nothing to absorb here.
 */
export const orDisabledDefault = <T>(value: T | null | undefined, fallback: T): T =>
  value ?? fallback

export const ensureInitialized = async () => {
  const store = sql
  if (!store) return

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await store.connect()
        const inList = (vals: readonly string[]) =>
          store.unsafe(`(${vals.map((v) => `'${v}'`).join(',')})`)
        // Level 0: foreign-key targets first. students/teams used to be
        // created in the same Promise.all as their dependents below, so on
        // a fresh database the dependents' `references` clauses raced the
        // target tables and init died with 42P01 — invisible on migrated
        // DBs, fatal on first boot. This level is awaited before anything.
        await Promise.all([
          (async () => {
            await store`
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
            await store`
          create table if not exists teams (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            name text not null,
            sport text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
            await store`
          create index if not exists idx_teams_org_auth0_id
          on teams (org_auth0_id);
        `
          })(),
        ])
        await Promise.all([
          (async () => {
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
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
            await store`
          -- Atomic quota gate (§17): one counter row per org+kind+day. The
          -- guarded UPDATE in tryReserveUsage serializes concurrent
          -- admissions on the row lock, so the cap check and the increment
          -- are one atomic step (see analyses.ts).
          create table if not exists usage_counters (
            org_auth0_id text not null,
            kind text not null,
            period_day date not null default current_date,
            total integer not null default 0,
            updated_at timestamptz not null default now(),
            primary key (org_auth0_id, kind, period_day)
          );
        `
          })(),
          (async () => {
            await store`
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
            await store`
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
            await store`
          create table if not exists organizations (
            auth0_id text primary key,
            name text,
            created_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
            await store`
          create table if not exists videos (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text,
            storage_key text not null unique,
            session_token text,
            file_name text,
            mime_type text,
            size_bytes bigint,
            duration_s double precision,
            width integer,
            height integer,
            has_audio boolean,
            status text not null default 'uploaded'
              check (status in ('uploaded', 'scanning', 'ready', 'failed', 'expired')),
            uploaded_by text,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
            await store`
          create table if not exists player_events (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text,
            server_job_id text,
            student_id uuid,
            category text not null,
            event_at_s double precision,
            form_score double precision,
            created_at timestamptz not null default now()
          );
        `
          })(),
          (async () => {
            await store`
          create table if not exists clips (
            id uuid primary key default gen_random_uuid(),
            server_job_id text not null,
            finding_id text,
            label text not null,
            start_ms integer not null check (start_ms >= 0),
            end_ms integer not null check (end_ms > start_ms),
            created_by text,
            created_at timestamptz not null default now()
          );
        `
            // Same block, not a sibling: the index raced the table on
            // fresh databases (same trap as the ADD COLUMN pairs).
            await store`
          create index if not exists idx_clips_server_job_id
          on clips (server_job_id);
        `
          })(),
          (async () => {
            await store`
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
            await store`
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
            await store`
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
          // org_members: create + role-check migration must run in order
          // (drop the stale four-role check, re-add the full-role version).
          (async () => {
            await store`
          create table if not exists org_members (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            member_auth0_id text,
            member_email text,
            role text not null check (role in ('owner','admin','head_coach','assistant_coach','coach','analyst','medical','player')),
            status text not null default 'active',
            invited_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            constraint org_members_unique unique (org_auth0_id, member_auth0_id)
          );
        `
            // Migrate pre-existing tables whose CHECK still lists only the four
            // original roles: drop the old role check (name discovered dynamically)
            // and re-add the full-role version. Idempotent.
            await store`
          do $$
          declare _conname text;
          begin
            select conname into _conname
            from pg_constraint
            where conrelid = 'org_members'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) like '%role in%';
            if _conname is not null and _conname <> 'org_members_role_check' then
              execute format('alter table org_members drop constraint %I', _conname);
            end if;
          end
          $$;
        `
            await store`
          alter table org_members
            drop constraint if exists org_members_role_check;
        `
            await store`
          alter table org_members
            add constraint org_members_role_check
            check (role in ('owner','admin','head_coach','assistant_coach','coach','analyst','medical','player'));
        `
            await store`
          create index if not exists idx_org_members_org_auth0_id
          on org_members (org_auth0_id);
        `
            await store`
          create index if not exists idx_org_members_member_auth0_id
          on org_members (member_auth0_id);
        `
          })(),
          (async () => {
            await store`
          create table if not exists org_invites (
            id uuid primary key default gen_random_uuid(),
            org_auth0_id text not null,
            email text not null,
            role text not null,
            token_hash text not null unique,
            created_by text,
            expires_at timestamptz not null,
            accepted_at timestamptz,
            revoked_at timestamptz,
            created_at timestamptz not null default now()
          );
        `
            await store`
          create index if not exists idx_org_invites_org_auth0_id
          on org_invites (org_auth0_id);
        `
            await store`
          create index if not exists idx_org_invites_token_hash
          on org_invites (token_hash);
        `
          })(),
          (async () => {
            await store`
          create table if not exists notification_preferences (
            auth0_id text primary key,
            in_app boolean not null default true,
            cadence text not null default 'instant'
              check (cadence in ('instant', 'daily', 'weekly')),
            events jsonb not null default '{"analysis_complete":true,"analysis_failed":true,"report_ready":true,"attendance":true,"ai_report":true,"membership":true}'::jsonb,
            updated_at timestamptz not null default now()
          );
        `
            // The digest window anchor. NULL means "never digested", which the
            // runner reads as the cadence lookback (24h/7d) rather than the
            // account's whole history. Additive column, same probe-or-alter
            // posture as notifications.dedupe_key above.
            await store`
          alter table notification_preferences
            add column if not exists last_digest_at timestamptz;
        `
          })(),
          // Account display settings (theme, reduce motion, week start). Self-scoped
          // for every role — no org, no FK — so they sync across devices without
          // depending on an organization membership.
          (async () => {
            await store`
          create table if not exists user_settings (
            auth0_id text primary key,
            theme text not null default 'system'
              check (theme in ('system', 'light', 'dark')),
            reduce_motion boolean not null default false,
            week_starts_monday boolean not null default false,
            updated_at timestamptz not null default now()
          );
        `
          })(),
          // Organization settings. `organizations.name` already exists but was
          // never editable or read — the switcher derived a display name from
          // the owner's user row instead. `timezone` anchors scheduling and
          // reporting so a club's "today" matches its own calendar.
          (async () => {
            const columns = await store<{ column_name: string }[]>`
              select column_name from information_schema.columns
              where table_name = 'organizations' and column_name = 'timezone';
            `
            if (columns.length === 0) {
              await store`alter table organizations add column timezone text;`
            }
          })(),
          // Player consent, recorded per purpose so a future policy version can be
          // re-consented. It is the player's own record, not an org field.
          (async () => {
            await store`
          create table if not exists player_consents (
            student_id uuid primary key references students(id) on delete cascade,
            training_data boolean not null default false,
            medical_data boolean not null default false,
            marketing boolean not null default false,
            policy_version text not null default '2026-09-26',
            updated_at timestamptz not null default now()
          );
        `
          })(),
          // Privacy requests. Recorded, never auto-executed: a deletion cascades
          // through analyses, reports, chat and audit rows, so it stays a reviewed
          // request rather than a button.
          (async () => {
            await store`
          create table if not exists privacy_requests (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            request_type text not null check (request_type in ('export', 'delete')),
            status text not null default 'received'
              check (status in ('received', 'in_progress', 'completed', 'declined')),
            created_at timestamptz not null default now(),
            resolved_at timestamptz
          );
        `
            await store`
          create index if not exists idx_privacy_requests_auth0
            on privacy_requests (auth0_id, created_at desc);
        `
          })(),
          // notifications: moved here from lib/notifications.ts so every table's
          // DDL is owned by this single schema mechanism (see teams note below).
          (async () => {
            await store`
          create table if not exists notifications (
            id uuid primary key default gen_random_uuid(),
            auth0_id text not null,
            type text not null,
            title text not null,
            body text,
            data jsonb not null default '{}'::jsonb,
            dedupe_key text,
            read boolean not null default false,
            created_at timestamptz not null default now()
          );
        `
            await store`
          alter table notifications
          add column if not exists dedupe_key text;
        `
            await store`
          create unique index if not exists notifications_auth0_dedupe_key_unique
          on notifications (auth0_id, dedupe_key)
          where dedupe_key is not null;
        `
            await store`
          create index if not exists idx_notifications_auth0_created
          on notifications (auth0_id, created_at desc);
        `
          })(),
        ])
        // Level: tables referencing students or teams — independent, run together.
        await Promise.all([
          (async () => {
            await store`
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
            await store`
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
            await store`
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
          (async () => {
            await store`
          create table if not exists team_memberships (
            id uuid primary key default gen_random_uuid(),
            team_id uuid not null references teams (id) on delete cascade,
            member_auth0_id text,
            student_id uuid,
            role text not null default 'player'
              check (role in ('coach', 'player')),
            created_at timestamptz not null default now(),
            -- NULLS NOT DISTINCT, not a plain unique: a btree unique index treats
            -- NULLs as distinct, so (team, member, NULL) — which is every coach
            -- membership, and the common case — was insertable without limit, and
            -- the ON CONFLICT clause in addTeamMember could never match it. The
            -- migration below repairs databases created before this.
            constraint team_memberships_unique
              unique nulls not distinct (team_id, member_auth0_id, student_id),
            constraint team_memberships_target_check
              check (member_auth0_id is not null or student_id is not null)
          );
        `
            await store`
          create index if not exists idx_team_memberships_team_id
          on team_memberships (team_id);
        `
            await store`
          create index if not exists idx_team_memberships_member
          on team_memberships (member_auth0_id);
        `
          })(),
        ])
        // Level: indexes, columns, and idempotent migrations — independent, run together.
        await Promise.all([
          (async () => {
            await store`
          create index if not exists idx_video_conversations_created_at
          on video_conversations (created_at desc);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_analysis_history_requested_at
          on analysis_history (requested_at desc);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_analysis_history_session_token
          on analysis_history (session_token);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_findings_server_job_id
          on findings (server_job_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_findings_created_at
          on findings (created_at desc);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_objectives_org_student
          on training_objectives (org_auth0_id, student_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_wellness_org_student
          on wellness_checkins (org_auth0_id, student_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_usage_org_day
          on usage_records (org_auth0_id, period_day);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_stages_job
          on analysis_stages (server_job_id, created_at);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_audit_logs_org_created
          on audit_logs (org_auth0_id, created_at desc);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_videos_storage_key
          on videos (storage_key);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_videos_session
          on videos (session_token);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_player_events_job
          on player_events (server_job_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_player_events_student_time
          on player_events (student_id, event_at_s);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_users_auth0_id
          on users (auth0_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_users_email
          on users (email);
        `
          })(),
          (async () => {
            // Repairs `team_memberships` on databases created before the
            // constraint became NULLS NOT DISTINCT. A btree unique index treats
            // NULLs as distinct, so coach memberships — (team, member, NULL) —
            // were never actually constrained: the seeder produced five copies of
            // each one, and addTeamMember's `on conflict ... do update set role`
            // was dead code for every coach. Collapse the duplicates (newest
            // wins, so the most recent role survives) and swap the constraint.
            //
            // Guarded on the constraint's own definition text rather than a
            // pg_index column, so this stays correct on a PG version that
            // predates indnullsnotdistinct, and returns immediately once the
            // database is already correct.
            await store`
          do $$
          declare
            _def text;
          begin
            select pg_get_constraintdef(c.oid) into _def
            from pg_constraint c
            join pg_class t on t.oid = c.conrelid
            where t.relname = 'team_memberships'
              and c.conname = 'team_memberships_unique'
            limit 1;

            if _def like '%NULLS NOT DISTINCT%' then
              return;
            end if;

            delete from team_memberships a
            using team_memberships b
            where a.team_id = b.team_id
              and a.member_auth0_id is not distinct from b.member_auth0_id
              and a.student_id is not distinct from b.student_id
              and (a.created_at, a.id) < (b.created_at, b.id);

            alter table team_memberships drop constraint if exists team_memberships_unique;
            alter table team_memberships
              add constraint team_memberships_unique
              unique nulls not distinct (team_id, member_auth0_id, student_id);
          end $$;
        `
          })(),
          (async () => {
            // Repairs jsonb columns that older writers filled with
            // JSON.stringify(value)::jsonb. On Bun's prepared-statement path
            // that stores a jsonb *string* whose text is the intended JSON, so
            // every read saw a string where an object was declared: notification
            // links vanished on reload (data.href was undefined) and
            // redactWellness passed summary_json through untouched, quietly
            // disabling the medical redaction on persisted analyses.
            //
            // Only rows that are currently a string are touched, and the first/
            // last-character prefilter keeps a malformed payload from aborting
            // the statement; the exception guard is the backstop for anything
            // that still fails to cast. Idempotent: a repaired row is an object,
            // so the second run matches nothing.
            const countStringJsonb = async (table: string, column: string): Promise<number> => {
              const rows = await store.unsafe<{ n: number }[]>(
                `select count(*)::int as n from ${table} where ${column} is not null and jsonb_typeof(${column}) = 'string';`,
              )
              return rows?.[0]?.n ?? 0
            }
            const repairDoubleEncodedJsonb = async (table: string, column: string) => {
              await store.unsafe(
                `do $$
                begin
                  update ${table}
                     set ${column} = (${column} #>> '{}')::jsonb
                   where ${column} is not null
                     and jsonb_typeof(${column}) = 'string'
                     and left(${column} #>> '{}', 1) in ('{', '[')
                     and right(${column} #>> '{}', 1) in ('}', ']');
                exception when others then
                  null;
                end $$;`,
              )
            }
            // Every jsonb column in the schema, not just the ones found to be
            // damaged: the list was originally short by `reports.content_json`,
            // and the live smoke's all-columns invariant caught the omission. A
            // column with nothing to repair is skipped by the guard below.
            for (const [table, column] of [
              ['analysis_history', 'status_json'],
              ['analysis_history', 'summary_json'],
              ['audit_logs', 'meta'],
              ['chat_messages', 'event_refs'],
              ['chat_messages', 'timestamp_refs'],
              ['findings', 'evidence_frames'],
              ['findings', 'model_versions'],
              ['notification_preferences', 'events'],
              ['notifications', 'data'],
              ['reports', 'content_json'],
              ['video_conversations', 'players_json'],
              ['video_conversations', 'scan_response_json'],
            ] as const) {
              const damaged = await countStringJsonb(table, column)
              if (damaged === 0) continue
              await repairDoubleEncodedJsonb(table, column)
              const remaining = await countStringJsonb(table, column)
              const repaired = damaged - remaining
              if (repaired > 0) {
                logger.warn('jsonb_double_encoded_rows_repaired', {
                  type: 'jsonb_double_encoded_rows_repaired',
                  table,
                  column,
                  repaired,
                  remaining,
                })
              }
            }
          })(),
          (async () => {
            await store`alter table users add column if not exists role text not null default 'coach';`
          })(),
          (async () => {
            await store`
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
            // The students status CHECK is inline and unnamed, so pre-existing
            // tables still enforce only the three original values: drop
            // whatever status check exists (name discovered dynamically) and
            // re-add the named full-vocabulary version. The match is on the
            // column name, not the `IN` spelling: Postgres normalizes
            // `x IN (...)` to `x = ANY (ARRAY[...])` in pg_get_constraintdef,
            // so `like '%status in%'` matches nothing on PG16+.
            await store`
          do $$
          declare _conname text;
          begin
            select conname into _conname
            from pg_constraint
            where conrelid = 'students'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) like '%status%';
            if _conname is not null and _conname <> 'students_status_check' then
              execute format('alter table students drop constraint %I', _conname);
            end if;
          end
          $$;
        `
            await store`
          alter table students
            drop constraint if exists students_status_check;
        `
            await store`
          alter table students
            add constraint students_status_check
            check (status in ${inList(STUDENT_STATUSES)});
        `
          })(),
          (async () => {
            // Column and index in one block: they ran as siblings in this
            // Promise.all and raced on fresh databases (index saw no column).
            await store`ALTER TABLE video_conversations ADD COLUMN IF NOT EXISTS auth0_id text;`
            await store`CREATE INDEX IF NOT EXISTS idx_video_conversations_auth0_id ON video_conversations (auth0_id);`
          })(),
          (async () => {
            await store`ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS auth0_id text;`
            await store`CREATE INDEX IF NOT EXISTS idx_analysis_history_auth0_id ON analysis_history (auth0_id);`
          })(),
          (async () => {
            await store`alter table analysis_history add column if not exists display_name text;`
          })(),
          (async () => {
            await store`alter table analysis_history add column if not exists requested_by text;`
          })(),
          (async () => {
            await store`alter table users add column if not exists linked_auth0_ids text[] default '{}';`
          })(),
          (async () => {
            await store`
          create index if not exists idx_chat_messages_server_job_id
          on chat_messages (server_job_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_chat_messages_auth0_id
          on chat_messages (auth0_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_students_auth0_id
          on students (auth0_id);
        `
          })(),
          (async () => {
            // Same column/index race as above: one sequential block.
            await store`alter table students add column if not exists account_auth0_id text;`
            await store`
          create index if not exists idx_students_account_auth0_id
          on students (account_auth0_id);
        `
          })(),
          (async () => {
            // Team assignment must exist before any student query runs. The
            // teams module's DDL moved here (single schema mechanism), so this
            // alter is owned solely by ensureInitialized — no lazy-DDL race
            // when student routes are hit first (smoke caught it). Column and
            // index stay in one block: as siblings they raced on fresh DBs.
            await store`alter table students add column if not exists team_id uuid;`
            await store`
          create index if not exists idx_students_team_id
          on students (team_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_attendance_auth0_id
          on attendance (auth0_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_attendance_session_date
          on attendance (session_date);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_schedule_auth0_id
          on schedule_events (auth0_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_schedule_starts_at
          on schedule_events (starts_at);
        `
          })(),
          (async () => {
            // The team dimension ADR-0002 §5 anticipated for the club calendar:
            // an event with no team is a club-level fixture every coach keeps
            // seeing, so the column is nullable and there is nothing to backfill
            // (every existing row is club-level by definition). `on delete
            // cascade` because the event belonged to that team — `set null`
            // would silently promote a deleted team's fixtures to org-wide.
            // Column and index in one block (same fresh-DB race as above).
            await store`
          alter table schedule_events
            add column if not exists team_id uuid references teams (id) on delete cascade;
        `
            await store`
          create index if not exists idx_schedule_team_id
          on schedule_events (team_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_reports_auth0_id
          on reports (auth0_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_reports_student_id
          on reports (student_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_perf_auth0_id
          on performance_metrics (auth0_id);
        `
          })(),
          (async () => {
            await store`
          create index if not exists idx_perf_student
          on performance_metrics (student_id, metric_key, measured_at desc);
        `
          })(),
          (async () => {
            await store`
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
            await store`
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
            await store`
          alter table analysis_history add column if not exists student_id uuid;
        `
            // Same block, not a sibling: the index raced the column on
            // fresh databases (the ADD COLUMN trap, fourth instance).
            await store`
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

/**
 * Test-only seam — deliberately NOT part of the module's public interface.
 * Swaps the connection so unit tests can pin the schema-before-callback
 * guarantee, init idempotence, and the degradation policy without a live DB.
 * Returns a restore function that also resets init state. Production code
 * must never call this.
 */
export const setHistoryStoreConnectionForTests = (next: SQL | null): (() => void) => {
  const previous = sql
  sql = next
  initPromise = null
  return () => {
    sql = previous
    initPromise = null
  }
}
