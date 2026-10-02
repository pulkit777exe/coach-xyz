import { expect, test } from 'bun:test'

import { withHistoryStoreOrThrow } from '../src/lib/historyStore'
import { createNotification } from '../src/lib/notifications'
import { describeLiveDb, useLiveTestDb } from './liveDb'

describeLiveDb('notification idempotency', () => {
  useLiveTestDb()

  // 60s budget, like the other live suites here: the first touch of a fresh
  // database also runs the whole schema DDL before any assertion.
  test(
    'deduplicates concurrent queue-derived notifications by auth0 and key',
    async () => {
      const auth0Id = `test|notification-dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const dedupeKey = `analysis_complete:${auth0Id}`

      try {
        const results = await Promise.all([
          createNotification({
            auth0Id,
            type: 'analysis_complete',
            title: 'Complete',
            data: { server_job_id: dedupeKey },
            dedupeKey,
          }),
          createNotification({
            auth0Id,
            type: 'analysis_complete',
            title: 'Complete',
            data: { server_job_id: dedupeKey },
            dedupeKey,
          }),
        ])

        expect(results.filter(Boolean)).toHaveLength(1)
        await withHistoryStoreOrThrow(async (db) => {
          const rows = await db<{ count: number }[]>`
          select count(*)::int as count
          from notifications
          where auth0_id = ${auth0Id} and dedupe_key = ${dedupeKey};
        `
          expect(rows[0]?.count).toBe(1)
          await db`delete from notifications where auth0_id = ${auth0Id};`
        })
      } finally {
        await withHistoryStoreOrThrow(async (db) => {
          await db`delete from notifications where auth0_id = ${auth0Id};`
        }).catch((error: unknown) => {
          console.error(
            `notification cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      }
    },
    { timeout: 60000 },
  )
})
