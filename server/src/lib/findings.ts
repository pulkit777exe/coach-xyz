import { ensureInitialized, withHistoryStore } from './historyStore'
import { applyEvidenceGate, findingNumber, findingText, type ReviewState } from './findingsPolicy'

// ── Findings persistence lives here; pure curation rules live in ─────────
// ./findingsPolicy (evidence gate, CSV shape, sanitizers, trend parser).
// Re-exported below so existing importers keep working during migration.
export {
  FINDINGS_CSV_COLUMNS,
  REVIEW_STATES,
  applyEvidenceGate,
  findingNumber,
  findingText,
  findingsToCsv,
  parseFindingsTrendQuery,
  type FindingsTrendQuery,
  type ReviewState,
} from './findingsPolicy'
export type FindingRecord = {
  id: string
  category?: string | null
  start_ms?: number | null
  end_ms?: number | null
  confidence?: number | null
  confidence_band?: string | null
  severity?: string | null
  observation?: string | null
  feedback?: string | null
  form_score?: number | null
  evidence_frames?: unknown
  measured_at_timestamp?: number | null
  model_versions?: unknown
  review_state?: string | null
}

/** Replace an analysis's findings (idempotent; safe to call per persist). */ export const persistFindings =
  async (serverJobId: string, findings: FindingRecord[]): Promise<void> => {
    const rows = (Array.isArray(findings) ? findings : [])
      .filter((f) => f && typeof f.id === 'string' && f.id.length > 0 && f.id.length <= 200)
      .map(applyEvidenceGate)
      .slice(0, 500)
    await withHistoryStore(async (db) => {
      await ensureInitialized()
      await db`delete from findings where server_job_id = ${serverJobId};`
      for (const f of rows) {
        await db`
        insert into findings (
          id, server_job_id, category, start_ms, end_ms, confidence,
          confidence_band, severity, observation, feedback, form_score,
          evidence_frames, measured_at_timestamp, model_versions, review_state
        ) values (
          ${f.id},
          ${serverJobId},
          ${findingText(f.category, 120) ?? 'technique'},
          ${findingNumber(f.start_ms)},
          ${findingNumber(f.end_ms)},
          ${findingNumber(f.confidence)},
          ${findingText(f.confidence_band, 20)},
          ${findingText(f.severity, 20)},
          ${findingText(f.observation)},
          ${findingText(f.feedback)},
          ${findingNumber(f.form_score)},
          ${JSON.stringify(Array.isArray(f.evidence_frames) ? f.evidence_frames.slice(0, 50) : [])}::jsonb,
          ${findingNumber(f.measured_at_timestamp)},
          ${JSON.stringify(f.model_versions && typeof f.model_versions === 'object' ? f.model_versions : {})}::jsonb,
          ${findingText(f.review_state, 20) ?? 'auto'}
        )
        on conflict (server_job_id, id) do nothing;
      `
      }
    })
  }

export type FindingsTrendPoint = {
  day: string
  category: string
  count: number
  needs_review: number
}

export type StoredFinding = {
  id: string
  server_job_id: string
  category: string | null
  start_ms: number | null
  end_ms: number | null
  confidence: number | null
  confidence_band: string | null
  severity: string | null
  observation: string | null
  feedback: string | null
  form_score: number | null
  evidence_frames: unknown
  measured_at_timestamp: number | null
  model_versions: unknown
  review_state: string
  created_at: string
}

/** Recent findings for one student's analyses (objective linking, §26). */

export const getStudentFindings = async (
  auth0Id: string,
  studentId: string,
  limit = 50,
): Promise<StoredFinding[]> => {
  const capped = Math.min(Math.max(limit, 1), 200)
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<StoredFinding[]>`
      select f.id, f.server_job_id, f.category, f.start_ms, f.end_ms,
        f.confidence, f.confidence_band, f.severity, f.observation,
        f.feedback, f.form_score, f.evidence_frames, f.measured_at_timestamp,
        f.model_versions, f.review_state, f.created_at
      from findings f
      join analysis_history a on a.server_job_id = f.server_job_id
      where a.auth0_id = ${auth0Id} and a.student_id = ${studentId}::uuid
      order by f.created_at desc
      limit ${capped};
    `
      return rows ?? []
    })) ?? []
  )
}

/** Human review transition (approve/flag). Only from auto/needs_review. */

export const reviewFinding = async (
  auth0Id: string,
  findingId: string,
  reviewState: ReviewState,
): Promise<boolean> => {
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<{ id: string }[]>`
      update findings set review_state = ${reviewState}
      where id = ${findingId}
        and review_state in ('auto', 'needs_review')
        and server_job_id in (
          select server_job_id from analysis_history where auth0_id = ${auth0Id}
        )
      returning id;
    `
      return Boolean(rows?.[0])
    })) ?? false
  )
}

/** Per-day finding counts for an account's analyses (longitudinal §26). */

export const getFindingsTrend = async (
  auth0Id: string,
  opts: {
    days?: number
    category?: string | null
    severity?: string | null
    studentId?: string | null
    teamId?: string | null
  } = {},
): Promise<FindingsTrendPoint[]> => {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365)
  return (
    (await withHistoryStore(async (db) => {
      await ensureInitialized()
      const rows = await db<FindingsTrendPoint[]>`
      select
        to_char(date_trunc('day', f.created_at), 'YYYY-MM-DD') as day,
        f.category as category,
        count(*)::int as count,
        count(*) filter (where f.review_state = 'needs_review')::int as needs_review
      from findings f
      join analysis_history a on a.server_job_id = f.server_job_id
      left join students s on s.id = a.student_id
      where a.auth0_id = ${auth0Id}
        and f.created_at >= now() - (${days} || ' days')::interval
        and (${opts.category ?? null}::text is null or f.category = ${opts.category ?? null})
        and (${opts.severity ?? null}::text is null or f.severity = ${opts.severity ?? null})
        and (${opts.studentId ?? null}::uuid is null or a.student_id = ${opts.studentId ?? null}::uuid)
        and (${opts.teamId ?? null}::uuid is null or s.team_id = ${opts.teamId ?? null}::uuid)
      group by 1, 2
      order by 1 asc, 2 asc;
    `
      return rows ?? []
    })) ?? []
  )
}

/** Delete an analysis and its derived rows (retention §30).
 * Removes history, findings, and chat messages. Engine artifacts expire via
 * job TTL; the rendered video 404s once the engine job is failed/expired. */
