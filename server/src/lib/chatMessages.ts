import { withHistoryStore } from './historyStore'
export type ChatMessageRecord = {
  id: string
  server_job_id: string
  auth0_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp_refs: number[] | null
  event_refs: number[] | null
  created_at: string | number | Date
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
  created_at: number
}

/**
 * Owner key for bearer (anonymous) capability chats. The chat_messages
 * auth0_id column is NOT NULL, so anonymous conversations persist under
 * this sentinel — always combined with the server_job_id filter (and the
 * job-level access check upstream), so jobs never leak across bearers.
 */
export const ANONYMOUS_AUTH0_ID = 'anonymous'

/** Bun returns jsonb columns as text — parse defensively to number arrays. */
const parseRefs = (value: unknown): number[] | undefined => {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            return null
          }
        })()
      : null
  if (!Array.isArray(list)) return undefined
  return list.filter((n): n is number => typeof n === 'number')
}

const toEpochSeconds = (value: string | number | Date): number => {
  if (typeof value === 'string') return new Date(value).getTime() / 1000
  if (value instanceof Date) return value.getTime() / 1000
  return value
}

/** Row → wire shape (epoch-seconds created_at, matching the web ChatMessage). */
export const toChatMessage = (m: ChatMessageRecord): ChatMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  timestamp_refs: parseRefs(m.timestamp_refs),
  event_refs: parseRefs(m.event_refs),
  created_at: toEpochSeconds(m.created_at),
})

export const saveChatMessage = async (msg: {
  serverJobId: string
  auth0Id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestampRefs?: number[]
  eventRefs?: number[]
}): Promise<ChatMessageRecord | null> => {
  return withHistoryStore(async (db) => {
    const rows = await db<ChatMessageRecord[]>`
      insert into chat_messages (server_job_id, auth0_id, role, content, timestamp_refs, event_refs)
      values (
        ${msg.serverJobId},
        ${msg.auth0Id},
        ${msg.role},
        ${msg.content},
        ${msg.timestampRefs ? JSON.stringify(msg.timestampRefs) : null}::jsonb,
        ${msg.eventRefs ? JSON.stringify(msg.eventRefs) : null}::jsonb
      )
      returning *;
    `
    return rows?.[0] ?? null
  })
}

export const getChatMessages = async (
  serverJobId: string,
  auth0Id: string,
): Promise<ChatMessageRecord[]> => {
  return (
    (await withHistoryStore(async (db) => {
      const rows = await db<ChatMessageRecord[]>`
      select * from chat_messages
      where server_job_id = ${serverJobId}
        and auth0_id = ${auth0Id}
      order by created_at asc;
    `
      return rows ?? []
    })) ?? []
  )
}
