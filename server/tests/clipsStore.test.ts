import { afterAll, describe, expect, test } from 'bun:test'

// ── Clips store integration (requires DATABASE_URL) ─────────────────────────
// Exercises the single-transaction createClip against the live history
// store: ownership + finding-match checks and the insert share one
// transaction, so begin() support is verified where it runs. Skipped
// without a DB, keeping the baseline green in CI.

const hasDb = Boolean(process.env.DATABASE_URL)

const tag = `clipstx-${Math.random().toString(36).slice(2, 8)}`
const auth0Id = `test|${tag}`
const serverJobId = `srv-${tag}`

async function cleanup(): Promise<void> {
  const { withHistoryStore } = await import('../src/lib/historyStore')
  await withHistoryStore(async (db) => {
    await db`delete from clips where server_job_id = ${serverJobId};`
    await db`delete from findings where server_job_id = ${serverJobId};`
    await db`delete from analysis_history where server_job_id = ${serverJobId};`
  }).catch(() => null)
}

afterAll(cleanup)

;(hasDb ? describe : describe.skip)('clips store integration', () => {
  test('createClip runs ownership, finding-match, and insert in one transaction', async () => {
    const { ensureInitialized, withHistoryStore } = await import('../src/lib/historyStore')
    const { createClip, deleteClip, countClips } = await import('../src/lib/clips')
    await ensureInitialized()

    await withHistoryStore(async (db) => {
      await db`
        insert into analysis_history (server_job_id, engine_job_id, model, auth0_id)
        values (${serverJobId}, ${`eng-${tag}`}, 'test', ${auth0Id});
      `
      await db`
        insert into findings (id, server_job_id, category)
        values (${`f-${tag}`}, ${serverJobId}, 'technique');
      `
    })

    try {
      const clip = await createClip(
        auth0Id,
        serverJobId,
        { label: 'Drive', start_ms: 0, end_ms: 1000, finding_id: `f-${tag}` },
        auth0Id,
      )
      expect(clip?.label).toBe('Drive')
      expect(clip?.finding_id).toBe(`f-${tag}`)
      expect(await countClips(auth0Id, serverJobId)).toBe(1)

      // Unknown finding → null, nothing inserted.
      const badFinding = await createClip(
        auth0Id,
        serverJobId,
        { label: 'Drive', start_ms: 0, end_ms: 1000, finding_id: 'missing' },
        auth0Id,
      )
      expect(badFinding).toBeNull()

      // Unowned analysis → null.
      const unowned = await createClip(
        `test|other-${tag}`,
        serverJobId,
        { label: 'Drive', start_ms: 0, end_ms: 1000 },
        auth0Id,
      )
      expect(unowned).toBeNull()
      expect(await countClips(auth0Id, serverJobId)).toBe(1)

      expect(await deleteClip(auth0Id, serverJobId, clip?.id ?? '')).toBe(true)
    } finally {
      await cleanup()
    }
  }, 30_000)
})
