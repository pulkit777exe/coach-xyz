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

/**
 * Atomically append a message to a conversation using a Lua script.
 * This eliminates the read-modify-write race condition where concurrent
 * saveMessage calls could silently lose messages.
 */
const APPEND_MSG_SCRIPT = `
local key = KEYS[1]
local msg = ARGV[1]
local ttl = tonumber(ARGV[2])
local now = ARGV[3]

local raw = redis.call('GET', key)
local conv

if raw then
  conv = cjson.decode(raw)
  table.insert(conv.messages, cjson.decode(msg))
  conv.updated_at = tonumber(now)
else
  conv = {
    messages = { cjson.decode(msg) },
    created_at = tonumber(now),
    updated_at = tonumber(now),
  }
end

redis.call('SET', key, cjson.encode(conv), 'EX', ttl)
return #conv.messages
`

export async function saveMessage(
  serverJobId: string,
  message: Omit<ChatMessage, "id" | "created_at">,
): Promise<ChatMessage> {
  const msg: ChatMessage = {
    ...message,
    id: generateId(),
    created_at: Date.now(),
  }

  await redis.eval(
    APPEND_MSG_SCRIPT,
    1,
    `${KEY}${serverJobId}`,
    JSON.stringify(msg),
    String(CONV_TTL),
    String(Date.now()),
  )

  return msg
}
