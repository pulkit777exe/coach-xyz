import { describe, expect, mock, test } from 'bun:test'

import {
  capabilityErrorStatus,
  gateRateLimit,
  mapEngineError,
  readJsonBody,
  resolveJobRoute,
  type CapabilitySet,
} from '../src/lib/capability'
import { buildError } from '../src/lib/errors'
import type { ServerJob } from '../src/lib/jobs'

const set = (): CapabilitySet => ({ headers: {} })
const request = (): Request => new Request('http://localhost/api/scan-video')

describe('gateRateLimit', () => {
  test('allowed checks pass through and emit the remaining header', async () => {
    const check = mock(async () => ({ allowed: true, remaining: 7, reset: Date.now() + 1000 }))
    const box = set()
    const gate = await gateRateLimit(request(), box, {
      check,
      deniedMessage: 'Slow down.',
    })
    expect(gate).toEqual({ proceed: true })
    expect(box.headers['X-RateLimit-Remaining']).toBe('7')
    expect(box.status).toBeUndefined()
  })

  test('denied checks map to 429 with retry_after', async () => {
    const reset = Date.now() + 30_000
    const check = mock(async () => ({ allowed: false, remaining: 0, reset }))
    const box = set()
    const gate = await gateRateLimit(request(), box, {
      check,
      deniedMessage: 'Slow down.',
    })
    expect(box.status).toBe(429)
    if (!gate.proceed) {
      expect(gate.status).toBe(429)
      expect(gate.body).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
      expect(gate.body).toHaveProperty('retry_after')
    } else {
      throw new Error('expected the gate to deny')
    }
  })

  test('routes that never sent the header opt out explicitly', async () => {
    const check = mock(async () => ({ allowed: true, remaining: 7, reset: Date.now() + 1000 }))
    const box = set()
    await gateRateLimit(request(), box, {
      check,
      deniedMessage: 'Slow down.',
      emitRemaining: false,
    })
    expect(box.headers['X-RateLimit-Remaining']).toBeUndefined()
  })
})

describe('resolveJobRoute', () => {
  const job = { server_job_id: 'srv-1', engine_job_id: 'eng-1', owner_ids: [] } as ServerJob

  test('missing jobs map to 404 JOB_NOT_FOUND', async () => {
    const box: { status?: number | string } = {}
    const resolved = await resolveJobRoute('missing', request(), box, {
      getJob: async () => null,
    })
    expect(box.status).toBe(404)
    if (!resolved.ok) {
      expect(resolved.status).toBe(404)
      expect(resolved.body).toMatchObject({ code: 'JOB_NOT_FOUND' })
    } else {
      throw new Error('expected the resolve to fail')
    }
  })

  test('anonymous jobs pass with their server row', async () => {
    const box: { status?: number | string } = {}
    const resolved = await resolveJobRoute('srv-1', request(), box, {
      getJob: async () => job,
    })
    expect(resolved).toMatchObject({ ok: true, serverJob: job })
  })
})

describe('capabilityErrorStatus', () => {
  test('maps scan-domain codes and defaults unknown codes to 500', () => {
    expect(capabilityErrorStatus('NO_PLAYERS_DETECTED')).toBe(422)
    expect(capabilityErrorStatus('VIDEO_DECODE_FAILED')).toBe(422)
    expect(capabilityErrorStatus('ENGINE_UNAVAILABLE')).toBe(503)
    expect(capabilityErrorStatus('MEDIAPIPE_UNAVAILABLE')).toBe(503)
    expect(capabilityErrorStatus('INVALID_REQUEST')).toBe(400)
    expect(capabilityErrorStatus('SOMETHING_ELSE')).toBe(500)
  })
})

describe('mapEngineError', () => {
  test('structured errors pass through by code', () => {
    const box: { status?: number | string } = {}
    const body = mapEngineError(box, buildError('ENGINE_UNAVAILABLE', 'down', true), {
      logType: 't',
      unknownMessage: 'u',
    })
    expect(box.status).toBe(503)
    expect(body).toMatchObject({ code: 'ENGINE_UNAVAILABLE' })
  })

  test('unknown failures normalize to a safe retryable 500', () => {
    const box: { status?: number | string } = {}
    const body = mapEngineError(box, new TypeError('fetch failed'), {
      logType: 't',
      unknownMessage: 'Try again.',
    })
    expect(box.status).toBe(500)
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true })
    expect(JSON.stringify(body)).not.toContain('fetch failed')
  })
})

describe('readJsonBody', () => {
  test('parses object bodies', async () => {
    const parsed = await readJsonBody(
      new Request('http://localhost/api/scan-intent', {
        method: 'POST',
        body: JSON.stringify({ filename: 'a.mp4' }),
      }),
    )
    expect(parsed).toEqual({ ok: true, body: { filename: 'a.mp4' } })
  })

  test('rejects malformed JSON and non-objects as 400', async () => {
    const malformed = await readJsonBody(
      new Request('http://localhost/api/scan-intent', { method: 'POST', body: '{{{' }),
    )
    expect(malformed.ok).toBe(false)

    const literalNull = await readJsonBody(
      new Request('http://localhost/api/scan-intent', { method: 'POST', body: 'null' }),
    )
    expect(literalNull.ok).toBe(false)
    if (!literalNull.ok) {
      expect(literalNull.body).toMatchObject({ code: 'INVALID_REQUEST' })
    }
  })
})
