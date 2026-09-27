import { orDisabledDefault, withHistoryStore } from './historyStore'
export type ChatMessageRecord = {
  id: string
  server_job_id: string
  auth0_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp_refs: number[] | null
  event_refs: number[] | null
  created_at: string
}

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
        ${msg.timestampRefs ?? null}::jsonb,
        ${msg.eventRefs ?? null}::jsonb
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
  return orDisabledDefault(
    await withHistoryStore(async (db) => {
      const rows = await db<ChatMessageRecord[]>`
      select * from chat_messages
      where server_job_id = ${serverJobId}
        and auth0_id = ${auth0Id}
      order by created_at asc;
    `
      return rows ?? []
    }),
    [],
  )
}
