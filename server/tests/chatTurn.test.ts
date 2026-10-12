import { afterEach, describe, expect, mock, test } from 'bun:test'

import { answerChatTurn } from '../src/lib/chatTurn'

const summary = {
  sport: 'Tennis',
  form_score: 8,
  overall_rating: 'Advanced',
  summary: 'Solid baseline session.',
  top_tips: ['Bend the knees', 'Follow through'],
  strengths: ['Footwork'],
  priority_drill: 'Shadow swings x20',
  shot_events: [
    { timestamp: 12.5, event_type: 'forehand', form_score: 8, feedback: 'Good rotation' },
  ],
}

const history = [{ role: 'user', content: 'How did I do?' }]

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('answerChatTurn', () => {
  test('returns the engine reply when the engine answers', async () => {
    const reply = await answerChatTurn(
      { message: 'How did I do?', summary, engineJobId: 'eng-1', conversationHistory: history },
      { chatWithEngine: async () => 'Engine says: solid session.' },
    )
    expect(reply).toBe('Engine says: solid session.')
  })

  test('passes the analysis context and history to the engine', async () => {
    let seen: {
      engineJobId: string
      message: string
      conversationHistory: { role: string; content: string }[]
      systemPrompt: string
    } | null = null
    await answerChatTurn(
      { message: 'Any tips?', summary, engineJobId: 'eng-1', conversationHistory: history },
      {
        chatWithEngine: async (args) => {
          seen = args
          return 'tips!'
        },
      },
    )
    expect(seen?.engineJobId).toBe('eng-1')
    expect(seen?.message).toBe('Any tips?')
    expect(seen?.conversationHistory).toEqual(history)
    expect(seen?.systemPrompt).toContain('Sport: Tennis')
    expect(seen?.systemPrompt).toContain('Form Score: 8/10')
    expect(seen?.systemPrompt).toContain('Rating: Advanced')
    expect(seen?.systemPrompt).toContain('Top Tips: Bend the knees; Follow through')
    expect(seen?.systemPrompt).toContain('Strengths: Footwork')
    expect(seen?.systemPrompt).toContain('Priority Drill: Shadow swings x20')
    expect(seen?.systemPrompt).toContain('Shot Events (1):')
  })

  test('falls back to keyword answers when the engine returns nothing', async () => {
    const reply = await answerChatTurn(
      {
        message: 'What was my score?',
        summary,
        engineJobId: 'eng-1',
        conversationHistory: history,
      },
      { chatWithEngine: async () => null },
    )
    expect(reply).toContain('8/10')
    expect(reply).toContain('Advanced')
  })

  test('falls back when the engine throws or replies empty', async () => {
    const throwing = await answerChatTurn(
      { message: 'Give me tips', summary, engineJobId: 'eng-1', conversationHistory: history },
      {
        chatWithEngine: async () => {
          throw new Error('boom')
        },
      },
    )
    expect(throwing).toContain('Bend the knees')

    const empty = await answerChatTurn(
      { message: 'What drills?', summary, engineJobId: 'eng-1', conversationHistory: history },
      { chatWithEngine: async () => '' },
    )
    expect(empty).toContain('Shadow swings x20')
  })

  test('falls back to the unavailable message without a summary', async () => {
    const reply = await answerChatTurn(
      {
        message: 'What was my score?',
        summary: null,
        engineJobId: 'eng-1',
        conversationHistory: [],
      },
      { chatWithEngine: async () => null },
    )
    expect(reply).toBe("I don't have the analysis details available. Please try again later.")
  })

  test('default engine path POSTs to the engine /chat endpoint', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ reply: 'live reply' }), { status: 200 })),
    ) as typeof fetch

    const reply = await answerChatTurn({
      message: 'How did I do?',
      summary,
      engineJobId: 'eng-1',
      conversationHistory: history,
    })
    expect(reply).toBe('live reply')

    const fetchMock = globalThis.fetch as ReturnType<typeof mock>
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(input).endsWith('/chat')).toBe(true)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ job_id: 'eng-1', message: 'How did I do?' })
    expect(typeof body.system_prompt).toBe('string')
    expect(body.conversation_history).toEqual(history)
  })

  test('default engine path falls back on engine errors', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    ) as typeof fetch

    const reply = await answerChatTurn({
      message: 'What was my score?',
      summary,
      engineJobId: 'eng-1',
      conversationHistory: history,
    })
    expect(reply).toContain('8/10')
  })
})
