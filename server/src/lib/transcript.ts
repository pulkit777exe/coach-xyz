// ── Chat transcript seam ─────────────────────────────────────────────────────
// One interface for chat conversation history, with two storage adapters
// over the stores that already exist:
//
//   • player flow  (routes/chat.ts)      → Redis coachai:conv:{server_job_id}
//                                           via lib/conversation.ts (2h TTL)
//   • dashboard flow (routes/chatHistory.ts) → Postgres chat_messages
//                                           via lib/chatMessages.ts
//
// This is a seam, not a merge: each flow keeps the store it uses today —
// exact keys, TTLs, column order, and append semantics all stay put. The win
// is that persistence style now sits behind one interface, so a future store
// unification is an adapter swap rather than a route rewrite.

import { getConversation, saveMessage } from './conversation'
import { getChatMessages, saveChatMessage } from './chatMessages'
import type { ChatMessageRecord } from './chatMessages'

export type TranscriptRole = 'user' | 'assistant' | 'system'

/**
 * Normalized transcript row — identical shape from either adapter.
 * `created_at` is epoch MILLISECONDS on both sides (Redis stores
 * `Date.now()`, Postgres timestamps are converted), so routes keep their
 * existing unit conversions on the wire.
 */
export type TranscriptMessage = {
  id: string
  role: TranscriptRole
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
  created_at: number
}

/** A message to append. Field names follow the wire/column vocabulary
 * (`timestamp_refs`, not `timestampRefs`) — adapters map to each store's
 * native call signature. */
export type TranscriptMessageInput = {
  role: TranscriptRole
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
}

/**
 * Store addressing. The Redis conversation is keyed by server job alone;
 * `chat_messages` rows are scoped (server_job_id, auth0_id), so adapters
 * declare the scope they need — the Postgres adapter rejects a missing auth0Id.
 */
export type TranscriptScope = {
  serverJobId: string
  auth0Id?: string | null
}

/** The seam: load full history and append one message, either store. */
export type Transcript = {
  load(scope: TranscriptScope): Promise<TranscriptMessage[]>
  append(scope: TranscriptScope, message: TranscriptMessageInput): Promise<void>
}

// ── Adapter 1: Redis conversation (player flow) ─────────────────────────────

/** lib/conversation.ts's exported function signatures — injectable for tests. */
export type ConversationStore = {
  getConversation: typeof getConversation
  saveMessage: typeof saveMessage
}

export const createRedisTranscript = (
  store: ConversationStore = { getConversation, saveMessage },
): Transcript => ({
  async load({ serverJobId }) {
    // Conversation rows are already the normalized shape (id/refs/ms epoch).
    return store.getConversation(serverJobId)
  },
  async append({ serverJobId }, message) {
    await store.saveMessage(serverJobId, {
      role: message.role,
      content: message.content,
      timestamp_refs: message.timestamp_refs,
      event_refs: message.event_refs,
    })
  },
})

// ── Adapter 2: Postgres chat_messages (dashboard flow) ──────────────────────

/** lib/chatMessages.ts's exported function signatures — injectable for tests. */
export type ChatMessageStore = {
  getChatMessages: typeof getChatMessages
  saveChatMessage: typeof saveChatMessage
}

function requireAuth0Id(scope: TranscriptScope): string {
  if (!scope.auth0Id) {
    throw new Error('Postgres chat transcript requires a non-empty auth0Id scope')
  }
  return scope.auth0Id
}

const fromRecord = (row: ChatMessageRecord): TranscriptMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  // jsonb columns are null when absent; Redis omits the key — normalize to
  // undefined so both adapters yield the same shape.
  timestamp_refs: row.timestamp_refs ?? undefined,
  event_refs: row.event_refs ?? undefined,
  created_at: new Date(row.created_at).getTime(),
})

export const createPostgresTranscript = (
  store: ChatMessageStore = { getChatMessages, saveChatMessage },
): Transcript => ({
  async load(scope) {
    const rows = await store.getChatMessages(scope.serverJobId, requireAuth0Id(scope))
    return rows.map(fromRecord)
  },
  async append(scope, message) {
    await store.saveChatMessage({
      serverJobId: scope.serverJobId,
      auth0Id: requireAuth0Id(scope),
      role: message.role,
      content: message.content,
      // camelCase is chatMessages' call vocabulary; the columns stay
      // timestamp_refs/event_refs inside the INSERT (chatMessages.ts).
      timestampRefs: message.timestamp_refs,
      eventRefs: message.event_refs,
    })
  },
})

// ── The two flows, bound to their current stores ────────────────────────────

/** Player flow: Redis conversation keyed by server job (2h TTL). */
export const playerTranscript: Transcript = createRedisTranscript()

/** Dashboard flow: Postgres chat_messages rows scoped (server job, account). */
export const dashboardTranscript: Transcript = createPostgresTranscript()
