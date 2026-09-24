import { describe, expect, test } from 'bun:test'
import { createPostgresTranscript, createRedisTranscript } from '../src/lib/transcript'
import type { Transcript, TranscriptMessage } from '../src/lib/transcript'
import type { ChatMessage } from '../src/lib/conversation'
import type { ChatMessageRecord } from '../src/lib/chatMessages'

const SERVER_JOB = 'job-transcript-1'
const AUTH0 = 'auth0|coach-1'
const EPOCH_MS = 1_700_000_000_000

// ── Store stubs ─────────────────────────────────────────────────────────────
// In-memory stand-ins for the two REAL stores, capturing every call so the
// adapters' store-level contracts (argument names, scoping) are pinned
// alongside the normalized output. Both stubs mint identical ids/timestamps,
// so the round-trip from each adapter must deep-equal.

function memoryConversationStore() {
  const rows = new Map<string, ChatMessage[]>()
  const saved: Array<{ serverJobId: string; message: Omit<ChatMessage, 'id' | 'created_at'> }> = []
  let seq = 0
  return {
    saved,
    async getConversation(serverJobId: string): Promise<ChatMessage[]> {
      return rows.get(serverJobId) ?? []
    },
    async saveMessage(
      serverJobId: string,
      message: Omit<ChatMessage, 'id' | 'created_at'>,
    ): Promise<ChatMessage> {
      saved.push({ serverJobId, message })
      seq += 1
      const stored: ChatMessage = { ...message, id: `msg-${seq}`, created_at: EPOCH_MS + seq }
      rows.set(serverJobId, [...(rows.get(serverJobId) ?? []), stored])
      return stored
    },
  }
}

type SavedPgMessage = {
  serverJobId: string
  auth0Id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestampRefs?: number[]
  eventRefs?: number[]
}

function memoryChatMessageStore() {
  const rows: ChatMessageRecord[] = []
  const saved: SavedPgMessage[] = []
  let seq = 0
  return {
    saved,
    async getChatMessages(serverJobId: string, auth0Id: string): Promise<ChatMessageRecord[]> {
      return rows.filter((r) => r.server_job_id === serverJobId && r.auth0_id === auth0Id)
    },
    async saveChatMessage(msg: SavedPgMessage): Promise<ChatMessageRecord> {
      saved.push(msg)
      seq += 1
      const stored: ChatMessageRecord = {
        id: `msg-${seq}`,
        server_job_id: msg.serverJobId,
        auth0_id: msg.auth0Id,
        role: msg.role,
        content: msg.content,
        // jsonb columns are null when absent — the adapter must normalize this.
        timestamp_refs: msg.timestampRefs ?? null,
        event_refs: msg.eventRefs ?? null,
        created_at: new Date(EPOCH_MS + seq).toISOString(),
      }
      rows.push(stored)
      return stored
    },
  }
}

describe('Transcript seam: both adapters satisfy one contract', () => {
  test('load/append round-trips are shape-identical across the two stores', async () => {
    const adapters: Transcript[] = [
      createRedisTranscript(memoryConversationStore()),
      createPostgresTranscript(memoryChatMessageStore()),
    ]
    // Redis keys on the server job alone; Postgres needs (job, account).
    const scopes = [{ serverJobId: SERVER_JOB }, { serverJobId: SERVER_JOB, auth0Id: AUTH0 }]

    const roundTrips: TranscriptMessage[][] = []
    for (const [i, adapter] of adapters.entries()) {
      const scope = scopes[i]
      await adapter.append(scope, { role: 'user', content: 'How was my serve?' })
      await adapter.append(scope, {
        role: 'assistant',
        content: 'At 12.0s your elbow drops.',
        timestamp_refs: [12],
        event_refs: [3],
      })
      roundTrips.push(await adapter.load(scope))
    }

    // Identical normalized shape from both adapters: ids/refs/ms-epoch dates
    // all line up because the stubs mint the same values.
    expect(roundTrips[0]).toEqual(roundTrips[1])
    expect(roundTrips[0].map((m) => m.created_at)).toEqual([EPOCH_MS + 1, EPOCH_MS + 2])
    // Refs survive the round-trip; absent refs are undefined on both sides
    // (Postgres null is normalized, not leaked).
    expect(roundTrips[0][1].timestamp_refs).toEqual([12])
    expect(roundTrips[0][1].event_refs).toEqual([3])
    expect(roundTrips[0][0].timestamp_refs).toBeUndefined()
    expect(roundTrips[0][0].event_refs).toBeUndefined()
  })

  test('adapters preserve each store’s native call contract', async () => {
    const redisStore = memoryConversationStore()
    const pgStore = memoryChatMessageStore()

    await createRedisTranscript(redisStore).append(
      { serverJobId: SERVER_JOB },
      { role: 'assistant', content: 'x', timestamp_refs: [1] },
    )
    await createPostgresTranscript(pgStore).append(
      { serverJobId: SERVER_JOB, auth0Id: AUTH0 },
      { role: 'assistant', content: 'x', timestamp_refs: [1] },
    )

    // Redis: keyed by server job alone, wire field names unchanged — this is
    // the coachai:conv:{server_job_id} call conversation.ts always made.
    expect(redisStore.saved).toEqual([
      {
        serverJobId: SERVER_JOB,
        message: { role: 'assistant', content: 'x', timestamp_refs: [1] },
      },
    ])

    // Postgres: scoped (server_job_id, auth0_id); camelCase call vocabulary
    // that chatMessages.ts maps onto the timestamp_refs/event_refs columns.
    expect(pgStore.saved).toEqual([
      {
        serverJobId: SERVER_JOB,
        auth0Id: AUTH0,
        role: 'assistant',
        content: 'x',
        timestampRefs: [1],
      },
    ])
  })

  test('the Postgres adapter rejects a scope without auth0Id', async () => {
    const pg = createPostgresTranscript(memoryChatMessageStore())
    await expect(pg.load({ serverJobId: SERVER_JOB })).rejects.toThrow(/auth0Id/)
    await expect(
      pg.append({ serverJobId: SERVER_JOB }, { role: 'user', content: 'x' }),
    ).rejects.toThrow(/auth0Id/)
  })

  test('the Redis adapter loads and appends with no auth0Id in scope', async () => {
    const store = memoryConversationStore()
    const redis = createRedisTranscript(store)
    await redis.append({ serverJobId: SERVER_JOB, auth0Id: null }, { role: 'user', content: 'hi' })
    const loaded = await redis.load({ serverJobId: SERVER_JOB })
    expect(loaded).toHaveLength(1)
    expect(loaded[0].content).toBe('hi')
  })
})
