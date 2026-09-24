import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Transport from 'winston-transport'

import { createLogger, type SentryCapture } from '../src/lib/logger'
import { formatAccessLog, shouldLogRequest } from '../src/lib/requestLog'

// ── Capture harness ─────────────────────────────────────────────────────────
// A custom winston transport collecting records is the reliable way to assert
// on output under Bun — no stdout/stderr scraping.

type LogRecord = Record<string, unknown> & { level: string; message: unknown }

class CaptureTransport extends Transport {
  records: LogRecord[] = []
  log(info: LogRecord, next: () => void): void {
    this.records.push({ ...info })
    next()
  }
}

/** Winston fans out to transports through its stream pipeline — yield to the
 *  event loop so every queued write has flushed before assertions run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 5))

/** The JSON line winston serialized (symbol-keyed, invisible to JSON.stringify
 *  of the record object itself). */
const jsonLine = (record: LogRecord): string => String(record[Symbol.for('message')])

describe('json format output', () => {
  test('serializes to one parseable JSON object with level/message/timestamp + type passthrough', async () => {
    const capture = new CaptureTransport()
    const log = createLogger({ format: 'json', level: 'info', transports: [capture] })

    log.info('json_check', { type: 'json_check', foo: 'bar' })
    await flush()

    expect(capture.records).toHaveLength(1)
    const parsed = JSON.parse(jsonLine(capture.records[0]))
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('json_check')
    expect(typeof parsed.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false)
    expect(parsed.type).toBe('json_check')
    expect(parsed.foo).toBe('bar')
  })
})

describe('level filtering', () => {
  test("level 'warn' suppresses info but passes error", async () => {
    const capture = new CaptureTransport()
    const log = createLogger({ format: 'json', level: 'warn', transports: [capture] })

    log.info('should_suppress', { type: 'should_suppress' })
    log.error('should_pass', { type: 'should_pass' })
    await flush()

    expect(capture.records.map((r) => r.message)).toEqual(['should_pass'])
  })
})

describe('key-based redaction', () => {
  test('sensitive keys become [redacted] at any depth; other keys untouched', async () => {
    const capture = new CaptureTransport()
    const log = createLogger({ format: 'json', level: 'info', transports: [capture] })

    log.info('redaction_check', {
      type: 'redaction_check',
      authorization: 'x',
      SERVICE_TOKEN: 'x',
      nested: { xAttribution: 'x', keep: 'visible' },
      keep_top: 'visible',
    })
    await flush()

    expect(capture.records).toHaveLength(1)
    const record = capture.records[0]
    expect(record.authorization).toBe('[redacted]')
    expect(record.SERVICE_TOKEN).toBe('[redacted]')
    const nested = record.nested as Record<string, unknown>
    expect(nested.xAttribution).toBe('[redacted]')
    expect(nested.keep).toBe('visible')
    expect(record.keep_top).toBe('visible')
    expect(record.type).toBe('redaction_check')
  })
})

describe('Sentry bridge routing', () => {
  test('error-level Error meta → captureException; non-Error error-level → captureMessage; warn never bridges', async () => {
    const capture = new CaptureTransport()
    const exceptions: unknown[] = []
    const messages: {
      message: string
      context: { level: string; extra: Record<string, unknown> }
    }[] = []
    const sentrySpy: SentryCapture = {
      captureException: (error) => {
        exceptions.push(error)
      },
      captureMessage: (message, context) => {
        messages.push({ message, context })
      },
    }
    const log = createLogger({
      format: 'json',
      level: 'info',
      transports: [capture],
      capture: sentrySpy,
    })

    const boom = new Error('boom')
    log.error('bridge_exception', { type: 'bridge_exception', error: boom })
    log.error('bridge_message', { type: 'bridge_message', detail: 'no Error attached' })
    log.warn('bridge_warn', { type: 'bridge_warn', detail: 'warn must not bridge' })
    await flush()

    // Error meta passed through redaction untouched (not a plain object), so
    // the bridge still receives the original instance.
    expect(exceptions).toEqual([boom])
    expect(messages).toHaveLength(1)
    expect(messages[0].message).toBe('bridge_message')
    expect(messages[0].context.level).toBe('error')
    expect(messages[0].context.extra.type).toBe('bridge_message')
    expect(messages.some((m) => m.message === 'bridge_warn')).toBe(false)
  })
})

describe('shouldLogRequest (access-log skip rule)', () => {
  test('/health is skipped; /, /api/... and /health/deep log', () => {
    expect(shouldLogRequest('/health')).toBe(false)
    expect(shouldLogRequest('/')).toBe(true)
    expect(shouldLogRequest('/api/job-status/abc')).toBe(true)
    expect(shouldLogRequest('/health/deep')).toBe(true)
  })
})

describe('formatAccessLog (access-log record shape)', () => {
  test('includes duration_ms, status and request_id', async () => {
    const capture = new CaptureTransport()
    const log = createLogger({ format: 'json', level: 'info', transports: [capture] })

    const fields = formatAccessLog({
      method: 'GET',
      path: '/api/job-status/abc',
      status: 200,
      durationMs: 12.6,
      requestId: 'req-1',
    })
    expect(fields).toEqual({
      type: 'request',
      method: 'GET',
      path: '/api/job-status/abc',
      status: 200,
      duration_ms: 13,
      request_id: 'req-1',
    })

    log.info('request', fields)
    await flush()
    const parsed = JSON.parse(jsonLine(capture.records[0]))
    expect(parsed.duration_ms).toBe(13)
    expect(parsed.status).toBe(200)
    expect(parsed.request_id).toBe('req-1')
  })

  test('path stays pathname-only — a query string (attribution token) never reaches the log', () => {
    const url = new URL('http://localhost/api/download/abc?attribution=secret-token')
    const fields = formatAccessLog({
      method: 'GET',
      path: url.pathname,
      status: 200,
      durationMs: 1,
      requestId: 'req-2',
    })
    expect(fields.path).toBe('/api/download/abc')
    expect(JSON.stringify(fields)).not.toContain('secret-token')
    expect(JSON.stringify(fields)).not.toContain('?')
  })
})

describe('timestamp ownership', () => {
  test('a converted-style call (no manual timestamp) yields exactly one timestamp field', async () => {
    const capture = new CaptureTransport()
    const log = createLogger({ format: 'json', level: 'info', transports: [capture] })

    log.info('ts_dedup', { type: 'ts_dedup' })
    await flush()

    const record = capture.records[0]
    const serialized = jsonLine(record)
    const timestampKeys = serialized.match(/"timestamp"/g) ?? []
    expect(timestampKeys).toHaveLength(1)
    // The single serialized timestamp is winston's, present on the record too.
    expect(typeof record.timestamp).toBe('string')
    expect(JSON.parse(serialized).timestamp).toBe(record.timestamp)
  })
})

describe('structural guard: no console.* call sites in server/src', () => {
  test('zero console.log/warn/error/info/debug tokens outside logger.ts', async () => {
    const srcDir = join(import.meta.dir, '../src')
    const files = (await readdir(srcDir, { recursive: true })).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(20) // the sweep actually ran over the tree

    const offenders: string[] = []
    for (const rel of files) {
      // logger.ts mentions console.* only in comments (stream-compat docs) — allowed.
      if (rel.endsWith('logger.ts')) continue
      const content = await readFile(join(srcDir, rel), 'utf8')
      const matches = content.match(/console\.(log|warn|error|info|debug)\b/g)
      if (matches) offenders.push(`${rel}: ${matches.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
