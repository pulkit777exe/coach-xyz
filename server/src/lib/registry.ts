import type { SQL } from 'bun'

import { orDisabledDefault, withHistoryStore } from './historyStore'

// ── Organization + video + event registries ────────────────────────────────
// The org identity stays the Auth0 sub (org_auth0_id); the organizations
// table carries the display name and audit trail for it. The videos table
// registers every upload intent so storage keys are traceable without
// listing buckets. player_events materializes the per-event timeline that
// findings summarize, for trend queries that don't need full summaries.

export type Organization = {
  auth0_id: string
  name: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const ensureOrg = async (
  orgAuth0Id: string,
  name?: string | null,
  createdBy?: string | null,
): Promise<Organization | null> => {
  if (!orgAuth0Id) return null
  return withHistoryStore(async (db: SQL) => {
    const rows = await db<Organization[]>`
      insert into organizations (auth0_id, name, created_by)
      values (${orgAuth0Id}, ${name?.trim().slice(0, 120) || null}, ${createdBy ?? null})
      on conflict (auth0_id) do update set
        name = coalesce(organizations.name, excluded.name),
        updated_at = now()
      returning auth0_id, name, created_by, created_at, updated_at;
    `
    return rows?.[0] ?? null
  })
}

export const getOrg = async (orgAuth0Id: string): Promise<Organization | null> => {
  return withHistoryStore(async (db: SQL) => {
    const rows = await db<Organization[]>`
      select auth0_id, name, created_by, created_at, updated_at
      from organizations where auth0_id = ${orgAuth0Id} limit 1;
    `
    return rows?.[0] ?? null
  })
}

export type VideoStatus = 'uploaded' | 'scanning' | 'ready' | 'failed' | 'expired'

export type VideoRecord = {
  id: string
  org_auth0_id: string | null
  storage_key: string
  session_token: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  duration_s: number | null
  width: number | null
  height: number | null
  has_audio: boolean | null
  status: VideoStatus
  uploaded_by: string | null
  created_at: string
}

export const registerVideo = async (input: {
  orgAuth0Id?: string | null
  storageKey: string
  sessionToken?: string | null
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  uploadedBy?: string | null
}): Promise<VideoRecord | null> => {
  return withHistoryStore(async (db: SQL) => {
    const rows = await db<VideoRecord[]>`
      insert into videos (
        org_auth0_id, storage_key, session_token, file_name, mime_type,
        size_bytes, uploaded_by
      ) values (
        ${input.orgAuth0Id ?? null},
        ${input.storageKey},
        ${input.sessionToken ?? null},
        ${input.fileName?.slice(0, 255) ?? null},
        ${input.mimeType?.slice(0, 120) ?? null},
        ${typeof input.sizeBytes === 'number' ? Math.floor(input.sizeBytes) : null},
        ${input.uploadedBy ?? null}
      )
      on conflict (storage_key) do update set
        session_token = coalesce(videos.session_token, excluded.session_token)
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const updateVideoProbe = async (
  storageKey: string,
  probe: {
    status: VideoStatus
    duration_s?: number | null
    width?: number | null
    height?: number | null
    has_audio?: boolean | null
  },
): Promise<void> => {
  await withHistoryStore(async (db: SQL) => {
    await db`
      update videos set
        status = ${probe.status},
        duration_s = coalesce(${probe.duration_s ?? null}, duration_s),
        width = coalesce(${probe.width ?? null}, width),
        height = coalesce(${probe.height ?? null}, height),
        has_audio = coalesce(${probe.has_audio ?? null}, has_audio)
      where storage_key = ${storageKey};
    `
  })
}

export type PlayerEventRecord = {
  id: string
  org_auth0_id: string | null
  server_job_id: string | null
  student_id: string | null
  category: string
  event_at_s: number | null
  form_score: number | null
  created_at: string
}

/** Materialize an analysis's shot events for timeline/trend queries. */
export const persistPlayerEvents = async (
  serverJobId: string,
  orgAuth0Id: string | null,
  studentId: string | null,
  events: Array<{ event_type?: unknown; timestamp?: unknown; form_score?: unknown }>,
): Promise<void> => {
  const rows = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e === 'object')
    .slice(0, 200)
  await withHistoryStore(async (db: SQL) => {
    await db`delete from player_events where server_job_id = ${serverJobId};`
    for (const e of rows) {
      const ts =
        typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) ? e.timestamp : null
      const score =
        typeof e.form_score === 'number' && Number.isFinite(e.form_score) ? e.form_score : null
      await db`
        insert into player_events (
          org_auth0_id, server_job_id, student_id, category, event_at_s, form_score
        ) values (
          ${orgAuth0Id},
          ${serverJobId},
          ${studentId}::uuid,
          ${typeof e.event_type === 'string' ? e.event_type.slice(0, 120) : 'technique'},
          ${ts},
          ${score}
        );
      `
    }
  })
}

export const listPlayerEvents = async (
  opts: { orgAuth0Id?: string | null; studentId?: string | null; jobId?: string | null },
  limit = 100,
): Promise<PlayerEventRecord[]> => {
  const capped = Math.min(Math.max(limit, 1), 500)
  return orDisabledDefault(
    await withHistoryStore(async (db: SQL) => {
      const rows = await db<PlayerEventRecord[]>`
        select * from player_events
        where (${opts.orgAuth0Id ?? null}::text is null or org_auth0_id = ${opts.orgAuth0Id ?? null})
          and (${opts.studentId ?? null}::uuid is null or student_id = ${opts.studentId ?? null}::uuid)
          and (${opts.jobId ?? null}::text is null or server_job_id = ${opts.jobId ?? null})
        order by event_at_s asc nulls last, created_at asc
        limit ${capped};
      `
      return rows ?? []
    }),
    [],
  )
}
