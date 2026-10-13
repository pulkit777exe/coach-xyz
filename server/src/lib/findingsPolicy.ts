// ── Findings policy (pure) ───────────────────────────────────────────────────
// Pure curation rules for findings: the evidence gate, CSV shape, input
// sanitizers, and the trends query parser. No I/O — unit-testable without
// infra. The persistence seam stays in ./findings (history rows); it
// imports these, and re-exports them so existing importers keep working.

import type { FindingRecord, StoredFinding } from './findings'

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

/** Column order for the findings CSV export (stable for spreadsheets). */
export const FINDINGS_CSV_COLUMNS = [
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

/** SQL-binding sanitizers: clamp free-form text and numbers at the edge. */
export const findingText = (value: unknown, max = 2000): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export const findingNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export type FindingsTrendQuery = {
  days: number
  category: string | null
  severity: string | null
  studentId: string | null
  teamId: string | null
}

const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pure parser for the findings-trends query string. Bounds days to 1..365,
 * strips text filters to a safe alphabet, and accepts only well-formed UUIDs
 * for id filters (they are interpolated as bound parameters, but tight input
 * keeps logs/URLs clean).
 */
export const parseFindingsTrendQuery = (params: URLSearchParams): FindingsTrendQuery => {
  const daysRaw = Number(params.get('days') || 30)
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 30
  const clean = (v: string | null): string | null => {
    if (!v) return null
    const t = v
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_ -]/g, '')
      .slice(0, 60)
    return t || null
  }
  const uuid = (v: string | null): string | null => {
    const t = v?.trim() ?? ''
    return UUID_PARAM_RE.test(t) ? t : null
  }
  return {
    days,
    category: clean(params.get('category')),
    severity: clean(params.get('severity')),
    studentId: uuid(params.get('student_id')),
    teamId: uuid(params.get('team_id')),
  }
}
