import type { ChatMessage } from '@/types'

import { getAttributionToken } from './data/attribution'
import { mutateJson, queryJson, streamJson, withTimeout } from './data/client'
import { authUserUrl, capabilityUrl } from './data/transport'

// ── Chat client ────────────────────────────────────────────────────────────
// Entity facade over the data core for live + persisted conversation.

// ── Chat API ─────────────────────────────────────────────────────────────────

export type { ChatMessage } from '@/types'

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; text: string; timestamp_refs: number[]; event_refs: number[] }
  | { type: 'error'; message: string }

/**
 * Stream a chat message via SSE. Yields parsed StreamEvents as they arrive.
 * Pass an AbortSignal to cancel the stream on unmount or user action.
 */
export async function* sendChatMessageStream(
  jobId: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const attribution = await getAttributionToken().catch(() => null)
  yield* streamJson<StreamEvent>(
    capabilityUrl('/api/chat/stream'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(attribution ? { 'x-attribution': attribution } : {}),
      },
      body: JSON.stringify({ job_id: jobId, message }),
      signal,
    },
    { failureCode: 'CHAT_FAILED', failureMessage: 'Chat request failed.' },
  )
}

export async function getConversation(jobId: string): Promise<{ messages: ChatMessage[] }> {
  return withTimeout(10_000, async (signal) => {
    const attribution = await getAttributionToken().catch(() => null)
    return queryJson<{ messages: ChatMessage[] }>(capabilityUrl(`/api/conversation/${jobId}`), {
      signal,
      headers: attribution ? { 'x-attribution': attribution } : {},
    })
  })
}

export const getHistoryChatMessages = async (
  auth0Id: string,
  jobId: string,
): Promise<{ messages: ChatMessage[] }> => {
  return queryJson<{ messages: ChatMessage[] }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/chat`),
  )
}

export const sendHistoryChatMessage = async (
  auth0Id: string,
  jobId: string,
  message: string,
): Promise<{ message: string; role: string }> => {
  return mutateJson<{ message: string; role: string }>(
    authUserUrl(auth0Id, `/analyses/${encodeURIComponent(jobId)}/chat`),
    'POST',
    { message },
  )
}
