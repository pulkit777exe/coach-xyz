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
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith(DATA_PREFIX)) continue
        try {
          yield JSON.parse(line.slice(DATA_PREFIX.length)) as T
        } catch {
          // Partial/Malformed JSON — skip this event
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
