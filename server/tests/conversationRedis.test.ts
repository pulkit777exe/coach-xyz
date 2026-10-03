import { describe, expect, mock, test } from 'bun:test'

// ── conversation.ts: the Redis transcript and its atomic-append contract ─────
//
// Two behaviours matter here and neither was exercised:
//
//  1. The append is ONE `EVAL` of a Lua script, not GET-modify-SET. That is the
//     whole reason this file exists in the shape it does: a read-modify-write
//     loses a message whenever two chat turns land at once, and the loss is
//     silent. The assertion is therefore that `saveMessage` never READS — a
//     test that only checked the returned message would pass against a
//     regression straight back to GET/SET.
//  2. The transcript is keyed by server job id under `coachai:conv:` and carries
//     the 2h TTL aligned with the job TTL. A wrong prefix would orphan every
//     transcript; a wrong TTL would either expire the chat mid-conversation or
//     pin it in Redis for the life of the process.
//
// `lib/redis` connects on import, so it is stubbed INERT — with a fake that
// records calls, because the call shape IS the subject. The mock is registered
// before the dynamic import below: a static import evaluates first, binds the
// real module, and the mock then applies to nothing (the trap tests/spawnProbe.ts
// documents). This file spawns nothing, and `--isolate` gives it its own module
// registry so the stub cannot leak.

type EvalCall = { script: string; numKeys: number; args: (string | number)[] }

const evalCalls: EvalCall[] = []
const store = new Map<string, unknown>()

const redisStub = {
  isLocalRedis: () => true,
  getRedisConnectionUrl: () => null,
  redis: {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: unknown) {
      store.set(key, value)
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0
    },
    async ping() {
      return 'PONG'
    },
    async rateLimitIncrement() {
      return { allowed: true, current: 0, reset: Date.now() }
    },
    async eval(script: string, numKeys: number, ...args: (string | number)[]) {
      evalCalls.push({ script, numKeys, args })
      // Stand in for the Lua script's `return #conv.messages`.
      return evalCalls.length
    },
  },
}

mock.module('../src/lib/redis', () => redisStub)

const { getConversation, saveMessage } = await import('../src/lib/conversation')

const KEY = 'coachai:conv:'

describe('conversation: the Redis transcript', () => {
  test('a key with nothing stored reads as an empty transcript, not a throw', async () => {
    expect(await getConversation('job-empty')).toEqual([])
  })

  test('a stored conversation comes back with its messages in order', async () => {
    const messages = [
      { id: 'aaaaaaaa', role: 'user' as const, content: 'first', created_at: 1 },
      { id: 'bbbbbbbb', role: 'assistant' as const, content: 'second', created_at: 2 },
    ]
    store.set(`${KEY}job-stored`, { messages, created_at: 1, updated_at: 2 })
    expect(await getConversation('job-stored')).toEqual(messages)
  })

  test('a stored value with no messages array reads as [] rather than undefined', async () => {
    // `conv.messages ?? []` is the difference between "no transcript" and a 500
    // in the chat route's spread of the result.
    store.set(`${KEY}job-partial`, { created_at: 1, updated_at: 2 })
    expect(await getConversation('job-partial')).toEqual([])
    store.set(`${KEY}job-empty-msgs`, { messages: [], created_at: 1, updated_at: 2 })
    expect(await getConversation('job-empty-msgs')).toEqual([])
  })

  test('transcripts of different jobs are independent', async () => {
    store.set(`${KEY}job-one`, { messages: [{ id: 'x', role: 'user' as const, content: 'one' }], created_at: 1, updated_at: 1 })
    store.set(`${KEY}job-two`, { messages: [{ id: 'y', role: 'user' as const, content: 'two' }], created_at: 1, updated_at: 1 })
    expect((await getConversation('job-one'))[0]!.content).toBe('one')
    expect((await getConversation('job-two'))[0]!.content).toBe('two')
    expect(await getConversation('job-three')).toEqual([])
  })

  test('saveMessage appends with ONE eval and never reads the key', async () => {
    // The anti-race assertion. A GET-modify-SET implementation calls `get`
    // here, and this test is written so that returning to that shape fails.
    evalCalls.length = 0
    store.clear()
    const readSpy = { calls: 0 }
    const originalGet = redisStub.redis.get
    redisStub.redis.get = async (key: string) => {
      readSpy.calls++
      return originalGet(key)
    }
    try {
      const saved = await saveMessage('job-atomic', { role: 'user', content: 'why?' })
      expect(saved.content).toBe('why?')
      expect(readSpy.calls).toBe(0)
    } finally {
      redisStub.redis.get = originalGet
    }
    expect(evalCalls.length).toBe(1)
  })

  test('the append is keyed, TTL-bound and carries the message JSON', async () => {
    evalCalls.length = 0
    const before = Date.now()
    const saved = await saveMessage('job-keyed', {
      role: 'assistant',
      content: 'Keep the elbow under the ball.',
      timestamp_refs: [1.5, 2.5],
      event_refs: [9],
    })
    expect(evalCalls.length).toBe(1)
    const [call] = evalCalls
    expect(call!.numKeys).toBe(1)
    expect(call!.args[0]).toBe(`${KEY}job-keyed`)

    const [msgJson, ttl, now] = call!.args.slice(1) as [string, string, string]
    expect(ttl).toBe('7200') // 2h, aligned with the job TTL
    expect(Number(now)).toBeGreaterThanOrEqual(before)

    // What goes over the wire is exactly what the caller got back — the id and
    // timestamp are generated here, not by Redis, so a caller-side log and the
    // stored row cannot disagree.
    expect(JSON.parse(msgJson)).toEqual(saved)
    expect(saved.role).toBe('assistant')
    expect(saved.content).toBe('Keep the elbow under the ball.')
    expect(saved.timestamp_refs).toEqual([1.5, 2.5])
    expect(saved.event_refs).toEqual([9])
  })

  test('the generated id is short and unique per message', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const saved = await saveMessage(`job-ids-${i}`, { role: 'user', content: `m${i}` })
      expect(saved.id).toHaveLength(8)
      ids.add(saved.id)
    }
    expect(ids.size).toBe(25)
  })

  test('created_at is stamped in ms and is not left to the caller', async () => {
    const before = Date.now()
    const saved = await saveMessage('job-stamp', { role: 'user', content: 'x' })
    expect(typeof saved.created_at).toBe('number')
    expect(saved.created_at).toBeGreaterThanOrEqual(before)
    expect(saved.created_at).toBeLessThanOrEqual(Date.now())
  })

  test('the Lua script really is an append-and-return, not a read-modify-write', async () => {
    evalCalls.length = 0
    await saveMessage('job-script', { role: 'user', content: 'x' })
    const script = evalCalls[0]!.script
    // The three properties that make the append safe: it READS inside the
    // script (so the whole read-modify-write is one atomic step), it only
    // SETs once, and it reports the new length.
    expect(script).toContain("redis.call('GET', key)")
    expect(script.match(/redis\.call\('SET'/g)?.length).toBe(1)
    expect(script).toContain("redis.call('SET', key, cjson.encode(conv), 'EX', ttl)")
    expect(script).toContain('return #conv.messages')
  })

  test('two appends in the same tick both run — neither is dropped by the client', async () => {
    // With the script, both land; the caller sees the server's count each time.
    // The client must not collapse or skip them.
    evalCalls.length = 0
    await Promise.all([
      saveMessage('job-concurrent', { role: 'user', content: 'a' }),
      saveMessage('job-concurrent', { role: 'user', content: 'b' }),
    ])
    expect(evalCalls.length).toBe(2)
  })

  test('a Redis `eval` that answers 0 (the noop client) still returns the message', async () => {
    // `lib/redis`'s noop client and its catch-all both answer 0. The function
    // must not treat that as a failure — the message is already built and the
    // route has nothing better to do than hand it back.
    const originalEval = redisStub.redis.eval
    redisStub.redis.eval = async () => 0
    try {
      const saved = await saveMessage('job-noop', { role: 'user', content: 'still here' })
      expect(saved.content).toBe('still here')
      expect(saved.id).toHaveLength(8)
    } finally {
      redisStub.redis.eval = originalEval
    }
  })
})