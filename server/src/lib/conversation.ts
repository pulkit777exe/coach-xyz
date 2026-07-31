import { redis } from "./redis"

const KEY = "coachai:conv:"
const CONV_TTL = 7200 // 2 hours, aligned with job TTL

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp_refs?: number[]
  event_refs?: number[]
  created_at: number
}

interface Conversation {
  messages: ChatMessage[]
  created_at: number
  updated_at: number
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 8)
}

export async function getConversation(
  serverJobId: string,
): Promise<ChatMessage[]> {
  const raw = await redis.get(`${KEY}${serverJobId}`)
  if (!raw) return []

  const conv = raw as Conversation
  return conv.messages ?? []
}

export async function saveMessage(
  serverJobId: string,
  message: Omit<ChatMessage, "id" | "created_at">,
): Promise<ChatMessage> {
  const msg: ChatMessage = {
    ...message,
    id: generateId(),
    created_at: Date.now(),
  }

  const raw = await redis.get(`${KEY}${serverJobId}`)
  let conv: Conversation

  if (raw) {
    conv = raw as Conversation
    conv.messages.push(msg)
    conv.updated_at = Date.now()
  } else {
    conv = {
      messages: [msg],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
  }

  await redis.set(`${KEY}${serverJobId}`, JSON.stringify(conv), { ex: CONV_TTL })
  return msg
}

export async function clearConversation(serverJobId: string): Promise<void> {
  await redis.del(`${KEY}${serverJobId}`)
}
