import { describe, expect, test } from 'bun:test'
import { createSseLineBuffer, parseSseDataEvents, sseDataJson } from '../src/lib/sse'

type ChatEvent = {
  type?: string
  text?: string
  message?: string
  timestamp_refs?: number[]
  event_refs?: number[]
}

const encoder = new TextEncoder()

/** A byte stream that enqueues one chunk per pull, then closes. */
function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      const chunk = chunks[i++]
      controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
    },
  })
}

async function collect(chunks: Array<string | Uint8Array>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const event of parseSseDataEvents<ChatEvent>(streamOf(chunks))) {
    events.push(event)
  }
  return events
}

/**
 * The pre-refactor per-chunk loop from routes/chat.ts (`text.split('\n')`
 * with no cross-chunk buffer), replicated so the straddle test pins BOTH
 * sides: this must lose the very event the buffered parser now captures.
 */
function naivePerChunkParse(chunks: Array<string | Uint8Array>): ChatEvent[] {
  const events: ChatEvent[] = []
  const decoder = new TextDecoder()
  for (const chunk of chunks) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        events.push(JSON.parse(line.slice(6)) as ChatEvent)
      } catch {
        /* partial JSON, ignore */
      }
    }
  }
  return events
}

describe('chunk boundaries', () => {
  test('a data line split across two chunks is captured (naive per-chunk split drops it)', async () => {
    const chunks = ['data: {"type":"done","te', 'xt":"serves up"}\n\n']

    // Old logic loses the event: fragment 1 parses as invalid JSON and is
    // discarded, fragment 2 no longer starts with `data: `. Pinned here so
    // this test fails against the old parser.
    expect(naivePerChunkParse(chunks)).toEqual([])

    expect(await collect(chunks)).toEqual([{ type: 'done', text: 'serves up' }])
  })

  test('a multi-byte character split across byte chunks reassembles', async () => {
    const bytes = encoder.encode('data: {"type":"token","text":"café"}\n\n')
    const accentStart = bytes.indexOf(0xc3) // first byte of é
    expect(accentStart).toBeGreaterThan(0)

    const events = await collect([bytes.slice(0, accentStart + 1), bytes.slice(accentStart + 1)])
    expect(events).toEqual([{ type: 'token', text: 'café' }])
  })
})

describe('createSseLineBuffer', () => {
  test('holds the partial tail until its newline arrives', () => {
    const buffer = createSseLineBuffer()
    expect(buffer.push('data: {"a"')).toEqual([])
    expect(buffer.push(':1}\nsec')).toEqual(['data: {"a":1}'])
    expect(buffer.end()).toEqual(['sec'])
  })

  test('strips CR from CRLF lines; end() on an empty residual emits nothing', () => {
    const buffer = createSseLineBuffer()
    expect(buffer.push('data: {"a":1}\r\n')).toEqual(['data: {"a":1}'])
    expect(buffer.end()).toEqual([])
  })
})

describe('sseDataJson', () => {
  test('parses data lines; comments, other fields, and bad JSON are null', () => {
    expect(sseDataJson<{ a: number }>('data: {"a":1}')).toEqual({ a: 1 })
    expect(sseDataJson(': ping')).toBeNull()
    expect(sseDataJson('event: message')).toBeNull()
    expect(sseDataJson('data: {nope')).toBeNull()
    expect(sseDataJson('')).toBeNull()
  })
})

describe('parseSseDataEvents', () => {
  test('token, done (with refs), and error events parse in order; heartbeats skipped', async () => {
    const events = await collect([
      ': ping\n\n',
      'data: {"type":"token","text":"Hel"}\n\n',
      'data: {"type":"token","text":"lo"}\n\n',
      'data: {"type":"done","text":"Hello","timestamp_refs":[1.5],"event_refs":[7]}\n\n',
      'data: {"type":"error","message":"boom"}\n\n',
    ])
    expect(events).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'done', text: 'Hello', timestamp_refs: [1.5], event_refs: [7] },
      { type: 'error', message: 'boom' },
    ])
  })

  test('CRLF-delimited events parse', async () => {
    expect(await collect(['data: {"type":"token","text":"x"}\r\n\r\n'])).toEqual([
      { type: 'token', text: 'x' },
    ])
  })

  test('a malformed data line is skipped without breaking the stream', async () => {
    expect(await collect(['data: {broken\n\ndata: {"type":"token","text":"ok"}\n\n'])).toEqual([
      { type: 'token', text: 'ok' },
    ])
  })

  test('a complete final line without a trailing newline is emitted at EOF', async () => {
    expect(await collect(['data: {"type":"done","text":"tail"}'])).toEqual([
      { type: 'done', text: 'tail' },
    ])
  })
})
