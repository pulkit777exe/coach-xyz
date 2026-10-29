// ── Structured logging ──────────────────────────────────────────────────────
// Every server log line is one JSON object with a `type` discriminator, which
// is what the log shipper parses. Keep the shape identical at every call site.
export type LogFields = Record<string, unknown>

export const logEvent = (
  level: 'info' | 'warn' | 'error',
  type: string,
  fields: LogFields = {},
): void => {
  const line = JSON.stringify({ type, ...fields })
  if (level === 'info') console.log(line)
  else if (level === 'warn') console.warn(line)
  else console.error(line)
}
