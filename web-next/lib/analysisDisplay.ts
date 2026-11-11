import { getShotEvents, summaryNumber, type SummaryCarrier } from './analysis'

export type EventDetectionCounts = {
  confirmed: number | null
  candidate: number
  uncertain: number
}

type EventDetectionLike = {
  confirmed?: unknown
  candidate?: unknown
  uncertain?: unknown
}

function toFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toCount(value: unknown): number | null {
  const n = toFinite(value)
  return n === null ? null : Math.max(0, Math.round(n))
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const n = toCount(value)
  return n === null ? fallback : n
}

function readEventDetection(blob: unknown): EventDetectionLike | null {
  if (!blob || typeof blob !== 'object') return null
  const ed = (blob as Record<string, unknown>).event_detection
  return ed && typeof ed === 'object' ? (ed as EventDetectionLike) : null
}

export function getSummaryBlob(analysis: SummaryCarrier): Record<string, unknown> | null {
  const blob = analysis?.summary_json
  return blob && typeof blob === 'object' && !Array.isArray(blob) ? (blob as Record<string, unknown>) : null
}

/** Confirmed/candidate/uncertain counts with fallbacks to total_events/shot_events. */
export function getEventDetectionCounts(analysis: SummaryCarrier): EventDetectionCounts {
  const blob = analysis?.summary_json
  const detection = readEventDetection(blob)
  const confirmedRaw = detection ? toCount(detection.confirmed) : null
  const totalEvents = summaryNumber(blob, 'total_events')
  const shotEvents = getShotEvents(analysis)
  const confirmed =
    confirmedRaw ??
    (totalEvents === null ? null : Math.max(0, Math.round(totalEvents))) ??
    (shotEvents.length > 0 ? shotEvents.length : null)

  return {
    confirmed,
    candidate: detection ? toNonNegativeInt(detection.candidate, 0) : 0,
    uncertain: detection ? toNonNegativeInt(detection.uncertain, 0) : 0,
  }
}

export function formatCount(value: number | null | undefined): string {
  const n = toFinite(value)
  return n === null ? '—' : String(Math.max(0, Math.round(n)))
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatScore10(value: number | null | undefined): string {
  const n = toFinite(value)
  return n === null ? '—' : `${trimDecimal(n)}/10`
}

/** Form/experimental score: "x/10" or "—" (unavailable). */
export function formatFormScore(value: number | null | undefined): string {
  return formatScore10(value)
}

export function formatAverageScore(value: number | null | undefined): string {
  return formatScore10(value)
}

/** 0–1 rate/proportion to percentage, null-safe. */
export function formatRatePercent(value: number | null | undefined): string {
  const n = toFinite(value)
  return n === null ? '—' : `${Math.round(n * 100)}%`
}

export function formatConfidencePercent(value: number | null | undefined): string {
  return formatRatePercent(value)
}

export function formatCoveragePercent(value: number | null | undefined): string {
  return formatRatePercent(value)
}

export function formatSuccessRate(value: number | null | undefined): string {
  return formatRatePercent(value)
}

export function isConfirmedEventState(state: unknown): boolean {
  return state == null || state === '' || state === 'confirmed'
}

export function eventStateBadgeLabel(state: unknown): string | null {
  if (isConfirmedEventState(state)) return null
  if (state === 'candidate') return 'Unconfirmed candidate'
  if (typeof state === 'string' && state.length > 0) return `Unconfirmed (${state})`
  return 'Unconfirmed candidate'
}

export function confirmedEventsText(counts: EventDetectionCounts): string {
  return `${formatCount(counts.confirmed)} confirmed events`
}

export function candidateCountLabel(count: number): string {
  return `${count} unconfirmed candidate${count === 1 ? '' : 's'}`
}

export function uncertainCountLabel(count: number): string {
  return `${count} uncertain`
}

export function historyConfirmedEventsLabel(analysis: SummaryCarrier): string | null {
  const counts = getEventDetectionCounts(analysis)
  return counts.confirmed === null ? null : `${counts.confirmed} confirmed event${counts.confirmed === 1 ? '' : 's'}`
}
