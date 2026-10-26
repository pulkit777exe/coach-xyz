// ── SSE Parser ──────────────────────────────────────────────────────────────
// One implementation for consuming `data: <json>` SSE streams. The scan
// progress feed and the chat stream both emit newline-delimited JSON events
// prefixed with `data: ` — share the chunk/line/parse loop instead of
// duplicating it per stream.

const DATA_PREFIX = 'data: '

/**
 * Parse a fetch Response as a stream of JSON events. Partial chunks are
 * buffered and split on newlines; non-`data:` lines and unparseable JSON are
 * skipped. The reader lock is always released.
 */
export async function* parseEventStream<T>(res: Response): AsyncGenerator<T, void, unknown> {
  // A null body (204, HEAD, mocked Response) throws a bare TypeError at
  // getReader() — fail here with a message that names the actual problem.
  if (!res.body) throw new Error('Event stream has no response body.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    const emitLine = function* (line: string): Generator<T> {
      if (!line.startsWith(DATA_PREFIX)) return
      try {
        yield JSON.parse(line.slice(DATA_PREFIX.length)) as T
      } catch {
        // Malformed JSON — skip this event rather than killing the stream.
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) yield* emitLine(line.endsWith('\r') ? line.slice(0, -1) : line)
    }

    // Flush a final data line that arrived without its terminating newline.
    buffer += decoder.decode()
    if (buffer) yield* emitLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer)
  } finally {
    reader.releaseLock()
  }
}
