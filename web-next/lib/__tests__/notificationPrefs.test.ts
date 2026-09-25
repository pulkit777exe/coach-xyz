import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getNotificationPrefs,
  NOTIFICATION_EVENT_LABELS,
  type NotificationPrefs,
  updateNotificationPrefs,
} from '../meApi'
import { notificationHref } from '../notifications'

const PREFS: NotificationPrefs = {
  inApp: true,
  cadence: 'instant',
  events: {
    analysis_complete: true,
    analysis_failed: true,
    report_ready: true,
    attendance: true,
    ai_report: true,
    membership: true,
  },
  updatedAt: null,
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('notification preferences API', () => {
  it('fetches the self-scoped preferences through the identity API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PREFS))
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', fetchMock)

    await expect(getNotificationPrefs()).resolves.toEqual(PREFS)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/me/notification-preferences',
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    )
  })

  it('PUTs a partial patch as JSON and returns the full preferences', async () => {
    const saved = { ...PREFS, inApp: false, updatedAt: '2026-09-25T00:00:00.000Z' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(saved))
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', fetchMock)
    const patch = { inApp: false, events: { attendance: false } }

    await expect(updateNotificationPrefs(patch)).resolves.toEqual(saved)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/me/notification-preferences')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(JSON.stringify(patch))
  })

  it('preserves the canonical API error from a failed preferences request', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { code: 'INVALID_REQUEST', message: 'bad preference', retryable: false },
            400,
          ),
        ),
    )

    await expect(updateNotificationPrefs({ inApp: false })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'bad preference',
      layer: 'server',
      retryable: false,
    })
  })
})

describe('notification preference vocabulary', () => {
  it('contains exactly the six server event keys', () => {
    expect(Object.keys(NOTIFICATION_EVENT_LABELS).sort()).toEqual(
      [
        'ai_report',
        'analysis_complete',
        'analysis_failed',
        'attendance',
        'membership',
        'report_ready',
      ].sort(),
    )
  })
})

describe('notificationHref', () => {
  it('prefers a recipient-correct data href', () => {
    expect(
      notificationHref({ data: { href: '/player/reports/report-1', server_job_id: 'job-1' } }),
    ).toBe('/player/reports/report-1')
  })

  it('falls back to the dashboard analysis route for legacy rows', () => {
    expect(notificationHref({ data: { server_job_id: 'job-1' } })).toBe('/dashboard/analysis/job-1')
  })

  it('returns null when neither destination is present', () => {
    expect(notificationHref({ data: {} })).toBeNull()
    expect(notificationHref({ data: { href: 42, server_job_id: null } })).toBeNull()
  })
})
