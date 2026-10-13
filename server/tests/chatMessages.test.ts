import { afterAll, describe, expect, test } from 'bun:test'

// ── Chat messages store integration (requires DATABASE_URL) ────────────────
// Proves the conversation merge: capability + library chat surfaces share
// one Postgres home keyed by (server_job_id, auth0_id), with the anonymous
// sentinel for bearer jobs. Skipped without a DB, keeping CI green.

const hasDb = Boolean(process.env.DATABASE_URL)

const tag = `chatmerge-${Math.random().toString(36).slice(2, 8)}`
const serverJobId = `srv-${tag}`
const owner = `test|${tag}`

async function cleanup(): Promise<void> {
  const { withHistoryStore } = await import('../src/lib/historyStore')
  await withHistoryStore(async (db) => {
    await db`delete from chat_messages where server_job_id = ${serverJobId};`
  }).catch(() => null)
}

afterAll(cleanup)

;(hasDb ? describe : describe.skip)('chat messages merge', () => {
  test('owner and anonymous keys round-trip through Postgres with the wire shape', async () => {
    const { ANONYMOUS_AUTH0_ID, getChatMessages, saveChatMessage, toChatMessage } =
      await import('../src/lib/chatMessages')

    try {
      await saveChatMessage({
        serverJobId,
        auth0Id: owner,
        role: 'user',
        content: 'hello',
      })
      await saveChatMessage({
        serverJobId,
        auth0Id: owner,
        role: 'assistant',
        content: 'hi',
        timestampRefs: [12.5],
        eventRefs: [],
      })
      await saveChatMessage({
        serverJobId,
        auth0Id: ANONYMOUS_AUTH0_ID,
        role: 'user',
        content: 'anon hello',
      })

      const owned = await getChatMessages(serverJobId, owner)
      expect(owned.map((m) => m.role)).toEqual(['user', 'assistant'])
      const wire = owned.map(toChatMessage)
      expect(wire[1]).toMatchObject({
        content: 'hi',
        timestamp_refs: [12.5],
        event_refs: [],
      })
      expect(typeof wire[0]?.created_at).toBe('number')

      // Owner and anonymous scopes never mix.
      const anon = await getChatMessages(serverJobId, ANONYMOUS_AUTH0_ID)
      expect(anon.map((m) => m.content)).toEqual(['anon hello'])
      expect(await getChatMessages(serverJobId, `test|other-${tag}`)).toEqual([])
    } finally {
      await cleanup()
    }
  }, 30_000)
})
