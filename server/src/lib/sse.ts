// ── Buffered SSE line parser ────────────────────────────────────────────────
// The engine's SSE feeds (chat/stream, scan-progress) deliver `data: <json>`
// lines that can STRADDLE chunk boundaries: a line split across two reads must
// be buffered until its newline arrives — parsing each chunk in isolation
// silently loses the fragments. Mirrors the proven residual-buffer approach in
// web-next/lib/sse.ts so both tiers parse the same wire the same way.

const DATA_PREFIX = 'data: '

const stripCR = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

export type SseLineBuffer = {
  /** Feed a decoded chunk; returns every line completed by this write. */
  push(chunk: string): string[]
  /** The residual line at end of stream, if any (may lack a trailing \n). */
  end(): string[]
}

/**
 * Residual-buffer line splitter. The partial tail after the last newline is
 * kept for the next `push`, so a `data:` line delivered in two pieces is only
 * emitted — once, intact — when its terminator arrives.
 */
export function createSseLineBuffer(): SseLineBuffer {
  let residual = ''
  return {
    push(chunk: string): string[] {
      residual += chunk
      const lines = residual.split('\n')
      residual = lines.pop() ?? ''
      return lines.map(stripCR)
    },
    end(): string[] {
      if (!residual) return []
      const tail = residual
      residual = ''
      return [stripCR(tail)]
    },
  }
}

/**
 * JSON payload of a `data: <json>` line, or null for everything else —
 * comment/heartbeat lines (`: ping`), other SSE fields, and malformed JSON
 * (skipped, never thrown, matching the web parser).
 */
export function sseDataJson<T>(line: string): T | null {
  if (!line.startsWith(DATA_PREFIX)) return null
  try {
    return JSON.parse(line.slice(DATA_PREFIX.length)) as T
  } catch {
    return null
  }
}

/**
 * Parse a byte stream of newline-delimited `data: <json>` SSE events.
 * Cross-chunk lines are buffered (see createSseLineBuffer); multi-byte UTF-8
 * sequences split across chunks are reassembled by the streaming TextDecoder.
 * The reader lock is always released.
 */
export async function* parseSseDataEvents<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<T, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const buffer = createSseLineBuffer()

  const emit = function* (lines: string[]): Generator<T> {
    for (const line of lines) {
      const payload = sseDataJson<T>(line)
      if (payload !== null) yield payload
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield* emit(buffer.push(decoder.decode(value, { stream: true })))
    }
    buffer.push(decoder.decode()) // flush any decoded tail
    yield* emit(buffer.end())
  } finally {
    reader.releaseLock()
  }
}
