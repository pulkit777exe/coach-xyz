// ── Server job registry ──────────────────────────────────────────────────────
// server_job_id → engine_job_id mapping used on hot status paths. The durable
// registry is Postgres (analysis_history, written at admission time); this is
// a thin view over it — no separate hot-cache store to go stale.
// `owner_ids` merges the account id and the requester so verifyJobAccess can
// decide on either identity.

import { withHistoryStore } from './historyStore'

export interface ServerJob {
  server_job_id: string
  engine_job_id: string
  session_token: string | null
  player_index: number | null
  model: string
  created_at: number
  /** Verified subs authorized to read this job (owner set). Empty/missing =
   * anonymous job — readable by bearer job id (demo/landing flow). */
  owner_ids?: string[]
}

const ownerSet = (auth0Id: string | null, requestedBy: string | null): string[] =>
  [...new Set([auth0Id, requestedBy].filter((s): s is string => Boolean(s)))]

export async function saveJob(job: ServerJob): Promise<void> {
  // Admission (persistAnalysisStart) already wrote the analysis row; this
  // upsert is the safety net for enqueue paths that bypass admission.
  const requestedBy = job.owner_ids?.[0] ?? null
  await withHistoryStore(async (db) => {
    await db`
      insert into analysis_history (
        server_job_id, engine_job_id, session_token, player_index,
        model, requested_by, updated_at
      ) values (
        ${job.server_job_id}, ${job.engine_job_id}, ${job.session_token},
        ${job.player_index}, ${job.model}, ${requestedBy}, now()
      )
      on conflict (server_job_id) do update set
        engine_job_id = excluded.engine_job_id,
        session_token = excluded.session_token,
        player_index = excluded.player_index,
        model = excluded.model,
        requested_by = coalesce(analysis_history.requested_by, excluded.requested_by),
        updated_at = now();
    `
  })
}

export async function getJob(serverJobId: string): Promise<ServerJob | null> {
  const rows = await withHistoryStore(
    (db) =>
      db<
        {
          server_job_id: string
          engine_job_id: string
          session_token: string | null
          player_index: number | null
          model: string
          requested_at: Date | string
          auth0_id: string | null
          requested_by: string | null
        }[]
      >`
        select server_job_id, engine_job_id, session_token, player_index, model,
               requested_at, auth0_id, requested_by
        from analysis_history where server_job_id = ${serverJobId} limit 1;
      `,
  )
  const row = rows?.[0]
  if (!row) return null
  return {
    server_job_id: row.server_job_id,
    engine_job_id: row.engine_job_id,
    session_token: row.session_token,
    player_index: row.player_index,
    model: row.model,
    created_at: new Date(row.requested_at).getTime(),
    owner_ids: ownerSet(row.auth0_id, row.requested_by),
  }
}
