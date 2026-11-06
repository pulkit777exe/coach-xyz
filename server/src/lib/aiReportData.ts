// ── AI report data layer ─────────────────────────────────────────────────────
// Orchestrates the lifecycle of a one-click AI report between Postgres
// (report_jobs table for polling + reports row for the persisted content).
// The worker in queue.ts imports persistAiReportRecord; routes import the job
// record helpers and the engine adapter below.

import { withTimeout, ENGINE_URL, engineServiceHeaders, isConnectivityError } from './engine'
import { buildReportContent, createReportRecord } from './orgReports'
import type { ReportType } from './orgEnums'
import type { CoachAIError } from '../types'
import { withHistoryStore } from './historyStore'

function engineError(code: string, message: string, retryable = true): CoachAIError {
  return { code, message, layer: 'engine', retryable }
}

// ── Job records (Postgres) ───────────────────────────────────────────────────

export type AiReportJobStatus = 'queued' | 'running' | 'done' | 'failed'

export type AiReportJob = {
  report_job_id: string
  auth0_id: string
  status: AiReportJobStatus
  report_id: string | null
  error: string | null
  progress: number
  created_at: number
  updated_at: number
}

type AiReportJobRow = {
  report_job_id: string
  auth0_id: string
  status: string
  report_id: string | null
  error: string | null
  progress: number
  created_at: Date | string
  updated_at: Date | string
}

const asJob = (row: AiReportJobRow): AiReportJob => ({
  report_job_id: row.report_job_id,
  auth0_id: row.auth0_id,
  status: row.status as AiReportJobStatus,
  report_id: row.report_id,
  error: row.error,
  progress: row.progress,
  created_at: new Date(row.created_at).getTime(),
  updated_at: new Date(row.updated_at).getTime(),
})

export async function initAiReportJob(input: {
  report_job_id: string
  auth0_id: string
}): Promise<AiReportJob> {
  const rows = await withHistoryStore(
    (db) =>
      db<AiReportJobRow[]>`
        insert into ai_report_jobs (report_job_id, auth0_id, status, progress, created_at, updated_at)
        values (${input.report_job_id}, ${input.auth0_id}, 'queued', 0, now(), now())
        on conflict (report_job_id) do update set
          auth0_id = excluded.auth0_id,
          updated_at = now()
        returning report_job_id, auth0_id, status, report_id, error, progress, created_at, updated_at;
      `,
  )
  if (!rows?.[0]) throw new Error('ai_report_jobs store unavailable')
  return asJob(rows[0])
}

export async function updateAiReportJob(
  reportJobId: string,
  patch: Partial<Pick<AiReportJob, 'status' | 'report_id' | 'error' | 'progress'>>,
): Promise<AiReportJob | null> {
  const rows = await withHistoryStore(
    (db) =>
      db<AiReportJobRow[]>`
        update ai_report_jobs set
          status = coalesce(${(patch.status as AiReportJobStatus | undefined) ?? null}::text, status),
          progress = coalesce(${patch.progress ?? null}::integer, progress),
          error = case when ${patch.error !== undefined} then ${patch.error ?? null}::text else error end,
          report_id = case when ${patch.report_id !== undefined}
                           then ${patch.report_id ?? null}::uuid else report_id end,
          updated_at = now()
        where report_job_id = ${reportJobId}
        returning report_job_id, auth0_id, status, report_id, error, progress, created_at, updated_at;
      `,
  )
  return rows?.[0] ? asJob(rows[0]) : null
}

export async function getAiReportJob(reportJobId: string): Promise<AiReportJob | null> {
  const rows = await withHistoryStore(
    (db) =>
      db<AiReportJobRow[]>`
        select report_job_id, auth0_id, status, report_id, error, progress, created_at, updated_at
        from ai_report_jobs where report_job_id = ${reportJobId} limit 1;
      `,
  )
  return rows?.[0] ? asJob(rows[0]) : null
}

// ── Engine adapter ───────────────────────────────────────────────────────────

export type EngineReportPayload = {
  report_context: Record<string, unknown>
  report_type: string
  sport?: string | null
  student_name?: string | null
}

export type EngineReportResult = {
  report: Record<string, unknown>
  raw: string
}

export const generateAiReport = async (
  payload: EngineReportPayload,
  requestId?: string | null,
): Promise<EngineReportResult> => {
  try {
    const res = await withTimeout(
      `${ENGINE_URL}/report`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...engineServiceHeaders(requestId),
        },
        body: JSON.stringify(payload),
      },
      120_000,
    ) // 2 min — long prompt, single Gemini round-trip

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      throw engineError(
        typeof body.code === 'string'
          ? body.code
          : res.status === 429
            ? 'GEMINI_QUOTA_EXCEEDED'
            : 'UNKNOWN',
        typeof body.message === 'string' ? body.message : 'AI report generation failed.',
        res.status >= 500,
      )
    }

    return (await res.json()) as EngineReportResult
  } catch (error) {
    if (isConnectivityError(error)) {
      throw engineError('ENGINE_UNAVAILABLE', 'AI engine is temporarily unavailable.')
    }
    throw error
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export type PersistAiReportInput = {
  auth0_id: string
  report_type: ReportType
  title: string
  period_start?: string | null
  period_end?: string | null
  student_id?: string | null
  report: Record<string, unknown>
  raw: string
}

export const persistAiReportRecord = async (
  input: PersistAiReportInput,
): Promise<{ id: string }> => {
  const { auth0_id, report, raw, ...meta } = input
  // Keep the raw Gemini output alongside the parsed report so the history row
  // is a durable source of truth for re-generation without re-calling Gemini.
  const contentJson: Record<string, unknown> = { ...report, raw_report: raw }
  const record = await createReportRecord(auth0_id, {
    ...meta,
    content_json: contentJson,
  })
  if (!record) {
    throw new Error('Failed to persist AI report (history store unavailable)')
  }
  return { id: record.id }
}

// Re-exported so routes can build the context fed to the engine without
// touching orgReports directly (keeps the org route file read-only).
export { buildReportContent }
