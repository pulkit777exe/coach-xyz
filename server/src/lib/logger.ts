// ── Logging (winston) ────────────────────────────────────────────────────────
// The single logging seam for server/src — never call `console.*` directly
// (structural guard: tests/logger.test.ts). Event continuity rule: every
// structured call passes a `type` meta field equal to the message, so the
// pre-winston `grep '"type":"..."'` log-shipping queries keep working — the
// JSON schema is a superset of the old one (`level` + `message` added).
// Winston owns the `timestamp` field; call sites must never pass their own.
//
// Module load constructs the singleton and nothing else: no sockets, no
// timers, no signal handlers — tests import it freely.

import * as Sentry from '@sentry/node'
import { createLogger as createWinstonLogger, format, transports } from 'winston'
import type { Logger } from 'winston'
import type { Format, TransformableInfo } from 'logform'
import Transport from 'winston-transport'

export type LogFormat = 'json' | 'pretty'

/** Level names winston ships with (npm set). Unknown LOG_LEVEL → 'info'. */
const VALID_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const

const resolveLevel = (): string => {
  const raw = (process.env.LOG_LEVEL ?? '').trim().toLowerCase()
  return (VALID_LEVELS as readonly string[]).includes(raw) ? raw : 'info'
}

/** json in production, pretty everywhere else, LOG_FORMAT wins when valid. */
const resolveFormat = (): LogFormat => {
  const raw = (process.env.LOG_FORMAT ?? '').trim().toLowerCase()
  if (raw === 'json' || raw === 'pretty') return raw
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty'
}

// ── Redaction (key-based) ───────────────────────────────────────────────────
// A meta KEY matching this pattern has its value replaced with '[redacted]'
// at any depth (cap below). Key-based only — string contents are never
// pattern-matched. Deliberately substring-style so the env-style spellings
// all hit: SERVICE_TOKEN, x-service-token, xAttribution, RESEND_API_KEY,
// apiKey, authorization, cookie, …
const SENSITIVE_KEY =
  /(service[-_]?token|attribution|authorization|cookie|api[-_]?key|secret|password|token)/i
const REDACTED = '[redacted]'
const REDACTION_DEPTH_CAP = 4

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Deep-copy walk that replaces sensitive-key values. Error instances (and
 *  other class instances) pass through untouched so the Sentry bridge still
 *  receives the original Error to capture. */
const redactValue = (value: unknown, depth: number): unknown => {
  if (depth >= REDACTION_DEPTH_CAP) return value
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1))
  if (value === null || typeof value !== 'object' || !isPlainObject(value)) return value
  const walked: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    walked[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(entry, depth + 1)
  }
  return walked
}

const redaction = format((info: TransformableInfo) => {
  for (const key of Object.keys(info)) {
    info[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(info[key], 0)
  }
  return info
})

// ── Sentry bridge ───────────────────────────────────────────────────────────
// Errors logged at level 'error' are forwarded to Sentry AFTER redaction.
// The capture functions are injectable so tests can assert the routing;
// production constructs the transport without arguments and uses @sentry/node
// (a no-op until instrument.ts calls Sentry.init — tests never do).
export type SentryCapture = {
  captureException: (error: unknown) => void
  captureMessage: (
    message: string,
    context: { level: 'error'; extra: Record<string, unknown> },
  ) => void
}

const sentryCapture: SentryCapture = {
  captureException: (error) => {
    Sentry.captureException(error)
  },
  captureMessage: (message, context) => {
    Sentry.captureMessage(message, { level: context.level, extra: context.extra })
  },
}

class SentryBridgeTransport extends Transport {
  private readonly capture: SentryCapture

  constructor(capture?: SentryCapture) {
    super({ level: 'error' })
    this.capture = capture ?? sentryCapture
  }

  log(info: TransformableInfo, next: () => void): void {
    if (info.level === 'error') {
      const metaError = info.err ?? info.error
      if (metaError instanceof Error) {
        this.capture.captureException(metaError)
      } else {
        const extra: Record<string, unknown> = {}
        for (const key of Object.keys(info)) {
          if (key === 'level' || key === 'message' || key === 'timestamp') continue
          extra[key] = info[key]
        }
        this.capture.captureMessage(String(info.message), { level: 'error', extra })
      }
    }
    next()
  }
}

// ── Output formats ──────────────────────────────────────────────────────────
// json: one JSON object per line — { level, message, timestamp, ...meta }.
// pretty: HH:mm:ss + colorized level + message + remaining meta, rendered by
// the Console transport's own format (transport formats run on a COPY of the
// info object, so colorizing there can never corrupt the raw level the Sentry
// bridge checks or what other transports record).
const buildFormat = (kind: LogFormat): Format =>
  format.combine(
    kind === 'json'
      ? format.timestamp()
      : format.timestamp({ format: () => new Date().toISOString().slice(11, 19) }),
    format.errors({ stack: true }),
    format.splat(),
    redaction(),
    ...(kind === 'json' ? [format.json()] : []),
  )

const prettyConsoleFormat = (): Format =>
  format.combine(
    format.colorize(),
    format.printf((info) => {
      const { level, message, timestamp, ...meta } = info
      const rest = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
      return `${String(timestamp)} ${String(level)} ${String(message)}${rest}`
    }),
  )

// error/warn → stderr, info → stdout: exactly the streams console.error/
// console.warn/console.log used before the migration (subprocess tests parse
// stdout; the graceful-shutdown paths behave the same under Bun).
const consoleTransport = (kind: LogFormat): Transport =>
  new transports.Console({
    stderrLevels: ['error'],
    consoleWarnLevels: ['warn'],
    ...(kind === 'pretty' ? { format: prettyConsoleFormat() } : {}),
  })

// ── Construction ────────────────────────────────────────────────────────────
export type CreateLoggerOptions = {
  /** Level name; defaults to LOG_LEVEL (invalid/absent → 'info'). */
  level?: string
  /** Output format; defaults to LOG_FORMAT (json in production, pretty else). */
  format?: LogFormat
  /** Replace the default Console transport — tests pass an in-memory capture. */
  transports?: Transport[]
  /** Suppress log output entirely (the Sentry bridge stays wired). */
  silent?: boolean
  /** Override the Sentry capture target — tests inject spies. */
  capture?: SentryCapture
}

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const kind = options.format ?? resolveFormat()
  const sinks: Transport[] = options.transports ? [...options.transports] : [consoleTransport(kind)]
  // The bridge is always attached and always runs after redaction — the
  // logger-level format chain mutates info before any transport sees it.
  sinks.push(new SentryBridgeTransport(options.capture))
  return createWinstonLogger({
    level: options.level ?? resolveLevel(),
    silent: options.silent ?? false,
    format: buildFormat(kind),
    transports: sinks,
  })
}

/** The process-wide logger, built from LOG_LEVEL/LOG_FORMAT at module load. */
export const logger: Logger = createLogger()
