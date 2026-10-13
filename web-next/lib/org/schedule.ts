// ── Org schedule subdomain ───────────────────────────────────────────────────
// Entity facade over the data core; re-exported via ../org.ts so existing
// direct-path imports keep working.

import { mutateJson, pickDefined, queryJson } from '../data/client'
import { orgUrl } from '../data/transport'
import type { ScheduleEvent } from './types'

// ── Schedule ─────────────────────────────────────────────────────────────────

export const orgSchedule = async (
  auth0Id: string,
  opts: { from?: string; to?: string } = {},
): Promise<{ events: ScheduleEvent[] }> => {
  const params = new URLSearchParams()
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return queryJson<{ events: ScheduleEvent[] }>(orgUrl(auth0Id, `/schedule${qs ? `?${qs}` : ''}`))
}

export const orgCreateEvent = async (
  auth0Id: string,
  input: Partial<ScheduleEvent>,
): Promise<{ event: ScheduleEvent }> => {
  return mutateJson<{ event: ScheduleEvent }>(
    orgUrl(auth0Id, '/schedule'),
    'POST',
    pickDefined(input),
  )
}

export const orgUpdateEvent = async (
  auth0Id: string,
  id: string,
  input: Partial<ScheduleEvent>,
): Promise<{ event: ScheduleEvent }> => {
  return mutateJson<{ event: ScheduleEvent }>(
    orgUrl(auth0Id, `/schedule/${encodeURIComponent(id)}`),
    'PUT',
    pickDefined(input),
  )
}

export const orgDeleteEvent = async (
  auth0Id: string,
  id: string,
): Promise<{ deleted: boolean }> => {
  return mutateJson<{ deleted: boolean }>(
    orgUrl(auth0Id, `/schedule/${encodeURIComponent(id)}`),
    'DELETE',
  )
}
