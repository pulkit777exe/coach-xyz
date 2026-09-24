// ── AI report data layer ─────────────────────────────────────────────────────
// Orchestrates the lifecycle of a one-click AI report between Redis (job
// record for polling) and Postgres (persisted reports row). The BullMQ worker
// in queue.ts imports persistAiReportRecord; routes import the job record
// helpers and the engine adapter below.

import { withTimeout, ENGINE_URL, engineServiceHeaders, isConnectivityError } from './engine'
import { buildReportContent, createReportRecord } from './orgData'
import type { ReportType } from './orgEnums'
import { engineFailure, wrapEngineError } from './errors'
import { redis } from './redis'

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

const KEY_PREFIX = 'coachai:reportjob:'
const JOB_TTL = 7200 // 2h — aligned with server job TTL

export const reportJobKey = (reportJobId: string) => `${KEY_PREFIX}${reportJobId}`

export async function initAiReportJob(input: {
  report_job_id: string
  auth0_id: string
}): Promise<AiReportJob> {
  const ts = Date.now()
  const record: AiReportJob = {
    report_job_id: input.report_job_id,
    auth0_id: input.auth0_id,
    status: 'queued',
    report_id: null,
    error: null,
    progress: 0,
    created_at: ts,
    updated_at: ts,
  }
  await redis.set(reportJobKey(input.report_job_id), record, { ex: JOB_TTL })
  return record
}

export async function updateAiReportJob(
  reportJobId: string,
  patch: Partial<Pick<AiReportJob, 'status' | 'report_id' | 'error' | 'progress'>>,
): Promise<AiReportJob | null> {
  const raw = await redis.get(reportJobKey(reportJobId))
  if (!raw) return null
  const record = raw as AiReportJob
  const next: AiReportJob = { ...record, ...patch, updated_at: Date.now() }
  await redis.set(reportJobKey(reportJobId), next, { ex: JOB_TTL })
  return next
}

export async function getAiReportJob(reportJobId: string): Promise<AiReportJob | null> {
  const raw = await redis.get(reportJobKey(reportJobId))
  if (!raw) return null
  return raw as AiReportJob
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
      // The engine owns code/message/retryable; only synthesize when the body
      // is missing them (e.g. a proxy stripped it). The HTTP status is
      // stamped alongside so callers can apply a posture helper.
      throw engineFailure(
        {
          code:
            typeof body.code === 'string'
              ? body.code
              : res.status === 429
                ? 'GEMINI_QUOTA_EXCEEDED'
                : 'UNKNOWN',
          message: typeof body.message === 'string' ? body.message : 'AI report generation failed.',
          retryable: typeof body.retryable === 'boolean' ? body.retryable : res.status >= 500,
        },
        res.status,
      )
    }

    return (await res.json()) as EngineReportResult
  } catch (error) {
    if (isConnectivityError(error)) {
      throw wrapEngineError({
        code: 'ENGINE_UNAVAILABLE',
        message: 'AI engine is temporarily unavailable.',
      })
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
// touching orgData directly (keeps the org route file read-only).
export { buildReportContent }
