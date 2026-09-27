import { orDisabledDefault, withHistoryStore } from './historyStore'
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

const findingText = (value: unknown, max = 2000): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

const findingNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

/** Replace an analysis's findings (idempotent; safe to call per persist). */ export const persistFindings =
  async (serverJobId: string, findings: FindingRecord[]): Promise<void> => {
    const rows = (Array.isArray(findings) ? findings : [])
      .filter((f) => f && typeof f.id === 'string' && f.id.length > 0 && f.id.length <= 200)
      .map(applyEvidenceGate)
      .slice(0, 500)
    await withHistoryStore(async (db) => {
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
          ${Array.isArray(f.evidence_frames) ? f.evidence_frames.slice(0, 50) : []}::jsonb,
          ${findingNumber(f.measured_at_timestamp)},
          ${f.model_versions && typeof f.model_versions === 'object' ? f.model_versions : {}}::jsonb,
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
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
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
    }),
    [],
  )
}

export const REVIEW_STATES = ['auto', 'approved', 'flagged'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

/**
 * Defense-in-depth evidence gate (§21): a stored finding must never claim a
 * strong band with no supporting frames. The engine enforces this at build
 * time; persistence re-applies it so backfilled or third-party rows cannot
 * smuggle an unsupported high/moderate claim into review queues. Pure.
 */
export const applyEvidenceGate = (finding: FindingRecord): FindingRecord => {
  const frames = Array.isArray(finding.evidence_frames) ? finding.evidence_frames : []
  const band = typeof finding.confidence_band === 'string' ? finding.confidence_band : null
  if ((band === 'high' || band === 'moderate') && frames.length === 0) {
    return { ...finding, confidence_band: 'needs_review', review_state: 'needs_review' }
  }
  return finding
}

/** Column order for the findings CSV export (stable for spreadsheets). */ export const FINDINGS_CSV_COLUMNS =
  [
    'id',
    'server_job_id',
    'category',
    'start_ms',
    'end_ms',
    'confidence',
    'confidence_band',
    'severity',
    'observation',
    'feedback',
    'form_score',
    'review_state',
    'created_at',
  ] as const

const CSV_FORMULA_RE = /^[=+\-@\t\r]/

/** Escape one CSV cell: defuse formula injection, quote delimiters. */
const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const raw = String(value)
  const safe = CSV_FORMULA_RE.test(raw) ? `'${raw}` : raw
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Serialize findings rows to CSV text (pure; BOM-free — the route adds it). */
export const findingsToCsv = (findings: StoredFinding[]): string => {
  const rows = (Array.isArray(findings) ? findings : []).map((f) => [
    f.id,
    f.server_job_id,
    f.category ?? '',
    f.start_ms ?? '',
    f.end_ms ?? '',
    f.confidence ?? '',
    f.confidence_band ?? '',
    f.severity ?? '',
    f.observation ?? '',
    f.feedback ?? '',
    f.form_score ?? '',
    f.review_state,
    f.created_at,
  ])
  return [FINDINGS_CSV_COLUMNS.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
}

/** Human review transition (approve/flag). Only from auto/needs_review. */

export const reviewFinding = async (
  auth0Id: string,
  findingId: string,
  reviewState: ReviewState,
): Promise<boolean> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
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
    }),
    false,
  )
}

/**
 * The analysis a finding belongs to, so the review mutation can be scoped to the
 * player that analysis is about. A finding has no `student_id` of its own — it
 * hangs off `server_job_id` — so the student comes from the analysis row.
 *
 * `found` is explicit rather than a nullable id for the same reason as
 * `getAnalysisStudentId`: `orDisabledDefault` would absorb a legitimate null.
 */
export const getFindingJobId = async (
  auth0Id: string,
  findingId: string,
): Promise<{ found: boolean; serverJobId: string | null }> => {
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const rows = await db<{ server_job_id: string }[]>`
        select f.server_job_id
        from findings f
        where f.id = ${findingId}
          and f.server_job_id in (
            select server_job_id from analysis_history where auth0_id = ${auth0Id}
          )
        limit 1;
      `
      const row = rows?.[0]
      if (!row) return { found: false, serverJobId: null }
      return { found: true, serverJobId: row.server_job_id }
    }),
    { found: false, serverJobId: null },
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
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
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
    }),
    [],
  )
}

/** Delete an analysis and its derived rows (retention §30).
 * Removes history, findings, and chat messages. Engine artifacts expire via
 * job TTL; the rendered video 404s once the engine job is failed/expired. */
