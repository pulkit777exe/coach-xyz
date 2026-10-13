import { describe, expect, test } from 'bun:test'

import { MAX_CHAT_MESSAGE_CHARS, validateChatMessage } from '../src/routes/chat'

describe('validateChatMessage', () => {
  test('accepts a normal message and trims it', () => {
    const result = validateChatMessage('  how did I do? ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('how did I do?')
  })

  test('rejects missing and blank messages', () => {
    for (const bad of [undefined, null, '', '   ', 42]) {
      const result = validateChatMessage(bad)
      expect(result.ok).toBe(false)
    }
  })

  test('rejects over-long messages (stored bloat + engine spend)', () => {
    const result = validateChatMessage('x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(String(MAX_CHAT_MESSAGE_CHARS))
  })

  test('accepts exactly the cap', () => {
    const result = validateChatMessage('x'.repeat(MAX_CHAT_MESSAGE_CHARS))
    expect(result.ok).toBe(true)
  })
})
