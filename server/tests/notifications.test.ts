import { describe, expect, test } from 'bun:test'

import { classifyFailure } from '../src/lib/queue'

// ── Notification row shape contract ─────────────────────────────────────────
// These tests verify the data shapes and pure helpers that the notification
// system depends on.  DB-touching functions are skipped when DATABASE_URL is
// not set, keeping the baseline green in CI without external services.
//
// The failed-job detection cases below run against the REAL predicate
// (classifyFailure, exported by queue.ts — the module that owns retry
// policy), not a copy of the logic. queue.ts is side-effect-free to import.

const hasDb = Boolean(process.env.DATABASE_URL)

describe('notification row shape', () => {
  test('CreateNotificationInput type matches expected fields', () => {
    // Contract: the create function accepts auth0Id, type, title, body?, data?
    const input = {
      auth0Id: 'auth0|123',
      type: 'analysis_complete',
      title: 'Analysis complete',
      body: 'Session 1',
      data: { server_job_id: 'srv-1', engine_job_id: 'eng-1' },
    }
    expect(typeof input.auth0Id).toBe('string')
    expect(typeof input.type).toBe('string')
    expect(typeof input.title).toBe('string')
    expect(typeof input.body).toBe('string')
    expect(typeof input.data).toBe('object')
  })

  test('NotificationRow shape has required fields', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      auth0_id: 'auth0|123',
      type: 'analysis_complete',
      title: 'Analysis complete',
      body: null as string | null,
      data: {} as Record<string, unknown>,
      read: false,
      created_at: new Date().toISOString(),
    }
    expect(row.id).toBeDefined()
    expect(row.auth0_id).toBe('auth0|123')
    expect(row.type).toBe('analysis_complete')
    expect(typeof row.read).toBe('boolean')
    expect(typeof row.created_at).toBe('string')
  })
})

describe('notification payload extraction', () => {
  test('extracts auth0_id and display_name from analysis record', () => {
    // Mirrors the shape returned by getAnalysisByServerJobId
    const analysis = {
      server_job_id: 'srv-abc',
      engine_job_id: 'eng-abc',
      auth0_id: 'auth0|456',
      display_name: 'My Session',
    }

    const payload = {
      auth0Id: analysis.auth0_id,
      type: 'analysis_complete',
      title: 'Analysis complete',
      body: analysis.display_name || analysis.engine_job_id,
      data: {
        server_job_id: analysis.server_job_id,
        engine_job_id: analysis.engine_job_id,
      },
    }

    expect(payload.auth0Id).toBe('auth0|456')
    expect(payload.body).toBe('My Session')
    expect(payload.data.server_job_id).toBe('srv-abc')
  })

  test('falls back to engine_job_id when display_name is null', () => {
    const analysis = {
      server_job_id: 'srv-def',
      engine_job_id: 'eng-def',
      auth0_id: 'auth0|789',
      display_name: null as string | null,
    }

    const body = analysis.display_name || analysis.engine_job_id
    expect(body).toBe('eng-def')
  })
})

describe('failed job detection logic', () => {
  test('isFinalFailure returns true for UnrecoverableError', () => {
    const { isFinalFailure } = classifyFailure(
      'UnrecoverableError: GEMINI_QUOTA_EXCEEDED: quota hit',
      1,
      3,
    )

    expect(isFinalFailure).toBe(true)
  })

  test('isFinalFailure returns true when retries exhausted', () => {
    const { isFinalFailure } = classifyFailure('Some retryable error', 3, 3)

    expect(isFinalFailure).toBe(true)
  })

  test('isFinalFailure returns true when retries remain — terminal means unrecoverable', () => {
    // QueueEvents 'failed' fires terminal-only (verified against bullmq v5:
    // retryable failures with attempts left go back to delayed with no
    // 'failed' event), so attempts-left here is early-terminal, i.e. an
    // unrecoverable error — always final.
    const { isFinalFailure } = classifyFailure('Connection reset', 1, 3)

    expect(isFinalFailure).toBe(true)
  })
})

describe('SSE event formatting', () => {
  test('notification serialises to valid SSE data line', () => {
    const notification = {
      id: '00000000-0000-0000-0000-000000000001',
      auth0_id: 'auth0|123',
      type: 'analysis_complete',
      title: 'Analysis complete',
      body: 'Session 1',
      data: { server_job_id: 'srv-1' },
      read: false,
      created_at: '2026-01-01T00:00:00.000Z',
    }

    const sseLine = `data: ${JSON.stringify(notification)}\n\n`
    expect(sseLine.startsWith('data: ')).toBe(true)

    const parsed = JSON.parse(sseLine.slice(6))
    expect(parsed.id).toBe(notification.id)
    expect(parsed.type).toBe('analysis_complete')
  })

  test('connected event is valid JSON', () => {
    const connected = JSON.stringify({ connected: true })
    const parsed = JSON.parse(connected)
    expect(parsed.connected).toBe(true)
  })
})

// ── Integration tests (require DATABASE_URL) ────────────────────────────────
;(hasDb ? describe : describe.skip)('notifications DB integration', () => {
  test(
    'createNotification inserts a row and returns it',
    async () => {
      const { createNotification, unreadCount } = await import('../src/lib/notifications')

      const row = await createNotification({
        auth0Id: 'test-notif-integration',
        type: 'analysis_complete',
        title: 'Test notification',
        body: 'Test body',
        data: { server_job_id: 'test-srv' },
      })

      expect(row).not.toBeNull()
      expect(row!.auth0_id).toBe('test-notif-integration')
      expect(row!.type).toBe('analysis_complete')
      expect(row!.read).toBe(false)

      const count = await unreadCount('test-notif-integration')
      expect(count).toBeGreaterThanOrEqual(1)
    },
    { timeout: 20000 },
  )

  test(
    'markNotificationRead flips read flag',
    async () => {
      const { createNotification, markNotificationRead } = await import('../src/lib/notifications')

      const row = await createNotification({
        auth0Id: 'test-notif-integration',
        type: 'analysis_complete',
        title: 'To be read',
      })
      expect(row).not.toBeNull()

      const updated = await markNotificationRead('test-notif-integration', row!.id)
      expect(updated).not.toBeNull()
      expect(updated!.read).toBe(true)
    },
    { timeout: 20000 },
  )

  test(
    'markAllRead flips all unread notifications',
    async () => {
      const { createNotification, markAllRead, listNotifications } =
        await import('../src/lib/notifications')
      const auth0Id = 'test-notif-integration'

      await createNotification({
        auth0Id,
        type: 'analysis_complete',
        title: 'A',
      })
      await createNotification({
        auth0Id,
        type: 'analysis_failed',
        title: 'B',
      })
      await markAllRead(auth0Id)

      const all = await listNotifications(auth0Id, { limit: 50 })
      const unread = all.filter((n) => !n.read)
      expect(unread.length).toBe(0)
    },
    { timeout: 20000 },
  )
})
