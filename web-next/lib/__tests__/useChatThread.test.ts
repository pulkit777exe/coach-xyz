import { describe, expect, it } from 'vitest'

import { makeChatMessage, makeErrorMessage, makeUserMessage } from '../useChatThread'

describe('chat message factories', () => {
  it('builds contract-shaped messages with unique ids', () => {
    const a = makeUserMessage('hello')
    const b = makeUserMessage('hello')
    expect(a).toMatchObject({ role: 'user', content: 'hello' })
    expect(typeof a.id).toBe('string')
    expect(a.id).not.toBe(b.id)
  })

  it('stamps epoch-seconds timestamps (the wire contract, not ms)', () => {
    const before = Date.now() / 1000
    const msg = makeChatMessage('assistant', 'hi')
    const after = Date.now() / 1000
    expect(msg.created_at).toBeGreaterThanOrEqual(before)
    expect(msg.created_at).toBeLessThanOrEqual(after)
  })

  it('marks error messages as system role', () => {
    expect(makeErrorMessage('boom')).toMatchObject({ role: 'system', content: 'boom' })
  })

  it('merges optional refs without touching id/role/content', () => {
    const msg = makeChatMessage('assistant', 'at 0:12', {
      timestamp_refs: [12],
      event_refs: [3],
    })
    expect(msg.timestamp_refs).toEqual([12])
    expect(msg.event_refs).toEqual([3])
    expect(msg.role).toBe('assistant')
  })
})
