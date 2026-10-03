import { beforeEach, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import { getChatMessages, saveChatMessage } from '../src/lib/chatMessages'
import { setHistoryStoreConnectionForTests } from '../src/lib/historyStore'

import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Chat messages: the durable transcript, and the degradation policy ────────
//
// `lib/chatMessages.ts` is the Postgres twin of `lib/conversation.ts`: the chat
// history that has to outlive the 2h Redis transcript window. Nothing in the
// suite touched it, and the two things it does are the two shapes a leak takes —
// an append that does not persist, and a read that crosses an org boundary.
//
// What is pinned here:
//
//   1. `getChatMessages` filters on `auth0_id` as well as `server_job_id`, so a
//      transcript is the org's and not the job's. `server_job_id` is a uuid a
//      client supplied, so keying on it alone would hand any member another
//      tenant's coach conversation.
//   2. The refs columns bind as `::jsonb`, and the BIND is the object — not
//      `JSON.stringify(obj)::jsonb`. On Bun's prepared-statement path the string
//      form is stored as a jsonb STRING, which every read rejects as a
//      non-object. Omitting the refs must produce SQL NULL, not the string
//      'null' and not `[]`.
//   3. Both functions go through `withHistoryStore` — the FAIL-OPEN wrapper — so
//      with no store they answer `null` / `[]` rather than throwing. That is the
//      degradation policy, and `null` is indistinguishable from "nothing stored",
//      which is exactly why the disabled case is worth pinning explicitly rather
//      than leaving to a CI-shaped environment.
//
// Live Postgres, and this file spawns nothing — see the note at the top of
// orgTeamScopeLive.test.ts for why the live half lives in its own file.

const ORG = 'auth0|chatmsg-org'
const OTHER = 'auth0|chatmsg-other'
const JOB = 'chatmsg-job-1'
const OTHER_JOB = 'chatmsg-job-2'

let db: SQL | null = null

const resetRows = async (conn: SQL) => {
  await conn`delete from chat_messages where server_job_id = ${JOB} or server_job_id = ${OTHER_JOB}`
}

describeLiveDb('chat_messages: org-scoped transcript, jsonb refs, and the fail-open policy', () => {
  useLiveTestDb({
    seed: async (conn) => {
      db = conn
      await resetRows(conn)
    },
    cleanup: async (conn) => {
      await resetRows(conn)
    },
  })

  beforeEach(async () => {
    await resetRows(db!)
  })

  test('saveChatMessage returns the inserted row, refs and all', async () => {
    const saved = await saveChatMessage({
      serverJobId: JOB,
      auth0Id: ORG,
      role: 'user',
      content: 'Why is my elbow dropping?',
      timestampRefs: [1.5, 2.5],
      eventRefs: [7, 9],
    })
    expect(saved).not.toBeNull()
    expect(saved!.server_job_id).toBe(JOB)
    expect(saved!.auth0_id).toBe(ORG)
    expect(saved!.role).toBe('user')
    expect(saved!.content).toBe('Why is my elbow dropping?')
    expect(saved!.timestamp_refs).toEqual([1.5, 2.5])
    expect(saved!.event_refs).toEqual([7, 9])
    expect(saved!.created_at).toBeTruthy()
  })

  test('refs bind as JSONB, not as a JSONB STRING', async () => {
    // The regression this pins: `${JSON.stringify(v)}::jsonb` on Bun's prepared
    // path stores a jsonb string, so every reader sees a non-object. Assert the
    // stored type, not just the round-trip — a string round-trips as a string.
    await saveChatMessage({
      serverJobId: JOB,
      auth0Id: ORG,
      role: 'assistant',
      content: 'Keep the elbow under the ball.',
      timestampRefs: [3],
      eventRefs: [11],
    })
    const [row] = await db!`
      select jsonb_typeof(timestamp_refs) as ts_type,
             jsonb_typeof(event_refs) as ev_type
      from chat_messages where server_job_id = ${JOB};
    `
    expect(row!.ts_type).toBe('array')
    expect(row!.ev_type).toBe('array')
  })

  test('omitted refs are SQL NULL — not an empty array and not the string "null"', async () => {
    const saved = await saveChatMessage({
      serverJobId: JOB,
      auth0Id: ORG,
      role: 'system',
      content: 'Context attached.',
    })
    expect(saved!.timestamp_refs).toBeNull()
    expect(saved!.event_refs).toBeNull()
    const [row] = await db!`
      select timestamp_refs, event_refs from chat_messages where server_job_id = ${JOB};
    `
    expect(row!.timestamp_refs).toBeNull()
    expect(row!.event_refs).toBeNull()
  })

  test('getChatMessages returns the transcript oldest-first', async () => {
    for (const [i, content] of ['first', 'second', 'third'].entries()) {
      await saveChatMessage({ serverJobId: JOB, auth0Id: ORG, role: 'user', content })
      // created_at defaults to now(), and three inserts can share a millisecond,
      // so make the ordering unambiguous rather than depending on clock
      // resolution: push each new row a second further into the future.
      await db!`update chat_messages set created_at = now() + interval '1 second' * ${i + 1} where server_job_id = ${JOB} and content = ${content}`
    }
    const messages = await getChatMessages(JOB, ORG)
    expect(messages.map((m) => m.content)).toEqual(['first', 'second', 'third'])
    expect(messages.every((m) => m.auth0_id === ORG)).toBe(true)
  })

  test('a transcript is the org\'s, not the job\'s: another org reads nothing', async () => {
    await saveChatMessage({ serverJobId: JOB, auth0Id: ORG, role: 'user', content: 'private' })
    expect(await getChatMessages(JOB, OTHER)).toEqual([])
    expect(await getChatMessages(JOB, 'auth0|chatmsg-nobody')).toEqual([])
  })

  test('a different org\'s messages for the SAME job id are never mixed in', async () => {
    await saveChatMessage({ serverJobId: JOB, auth0Id: ORG, role: 'user', content: 'mine' })
    await saveChatMessage({ serverJobId: JOB, auth0Id: OTHER, role: 'user', content: 'theirs' })
    expect((await getChatMessages(JOB, ORG)).map((m) => m.content)).toEqual(['mine'])
    expect((await getChatMessages(JOB, OTHER)).map((m) => m.content)).toEqual(['theirs'])
  })

  test('an unknown job reads as an empty list, not a throw', async () => {
    expect(await getChatMessages('chatmsg-nothing-here', ORG)).toEqual([])
  })

  test('a DIFFERENT job id in the same org is a different transcript', async () => {
    await saveChatMessage({ serverJobId: JOB, auth0Id: ORG, role: 'user', content: 'job one' })
    await saveChatMessage({
      serverJobId: OTHER_JOB,
      auth0Id: ORG,
      role: 'user',
      content: 'job two',
    })
    expect((await getChatMessages(JOB, ORG)).map((m) => m.content)).toEqual(['job one'])
    expect((await getChatMessages(OTHER_JOB, ORG)).map((m) => m.content)).toEqual(['job two'])
  })

  test('a role outside the DDL CHECK is SILENTLY DROPPED, not rejected', async () => {
    // Real behaviour, pinned rather than wished for: `saveChatMessage` uses the
    // FAIL-OPEN `withHistoryStore`, so the CHECK violation surfaces as a logged
    // `history_store_operation_failed` and the function answers `null` — the
    // same answer as "the store is disabled" and the same answer the write path
    // uses for success-with-no-row. Nothing tells the caller the message was
    // rejected, so a transcript can lose a turn silently. The row is genuinely
    // absent, which is the part that is safe.
    const rejected = await saveChatMessage({
      serverJobId: JOB,
      auth0Id: ORG,
      // @ts-expect-error — deliberately outside the declared union
      role: 'coach',
      content: 'nope',
    })
    expect(rejected).toBeNull()
    const stored = await db!`select count(*)::int as n from chat_messages where content = 'nope'`
    expect(stored[0]!.n).toBe(0)
  })

  test('with the store absent both functions degrade instead of throwing', async () => {
    // `withHistoryStore` is the fail-open wrapper: `null` from the callback is
    // returned as-is, and `orDisabledDefault` turns that into `[]` for the read.
    // Note the asymmetry this creates and that it is deliberate — the write
    // reports "nothing stored" (null) and the read reports "no messages" ([]),
    // so a chat history is silently empty rather than a 500.
    const restore = setHistoryStoreConnectionForTests(null)
    try {
      expect(await saveChatMessage({ serverJobId: JOB, auth0Id: ORG, role: 'user', content: 'x' })).toBeNull()
      expect(await getChatMessages(JOB, ORG)).toEqual([])
    } finally {
      restore()
    }
  })

  test('the store is usable again after the degraded call restored it', async () => {
    // Guards the test above against silently leaving the module-level slot null
    // — which would make every later assertion in this file a green run against
    // nothing.
    expect(await saveChatMessage({ serverJobId: JOB, auth0Id: ORG, role: 'user', content: 'back' })).not.toBeNull()
    expect((await getChatMessages(JOB, ORG)).map((m) => m.content)).toEqual(['back'])
  })
})