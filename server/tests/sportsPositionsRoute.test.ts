import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { sportPositionsRoute } from '../src/routes/sports'

// ── routes/sports.ts: the DEGRADATION branch, which is the one that ships
// wrong data silently ─────────────────────────────────────────────────────────
//
// The vocabulary proxy answers roster forms from the engine's sport packs. When
// the engine is unreachable — or answers non-2xx, or answers 2xx with something
// that is not a position list — the route answers **200 with an empty list**
// rather than failing. That is a deliberate product decision (a roster form must
// still render) and it is also the most dangerous shape in this file: nothing
// errors, nothing is logged, and the screen simply shows no positions. Nothing in
// the suite touched those branches; `cleanPositions` was unit-tested but the
// handler was not called at all.
//
// Three properties are pinned:
//   • a failure degrades to `[]` with 200, never to a 5xx and never to a stale
//     shape,
//   • the in-memory CACHE keeps serving real positions through an engine outage
//     (a route that hard-failed on the first miss would be far more visible;
//     this one is quiet, which is the point),
//   • a malformed or missing `positions` payload is cached AS EMPTY, so a single
//     bad engine response poisons that sport for the full hour.
//
// `fetch` is stubbed globally rather than through a module mock: the route calls
// the global, and the URL + headers it sends are part of what is under test.
// The route's cache is module-level, so each case uses its own sport name.

type SportPosition = { id: string; label: string; description: string }

const realFetch = globalThis.fetch

type FetchCall = { url: string; init: RequestInit | undefined }

let calls: FetchCall[] = []
let respond: (url: string) => Response | Promise<Response>

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const ask = async (
  sport: string,
  init: RequestInit = {},
): Promise<{ status: number; body: { sport: string; positions: SportPosition[] } }> => {
  const res = await sportPositionsRoute.handle(
    new Request(`http://localhost/api/sports/${sport}/positions`, init),
  )
  return { status: res.status, body: (await res.json()) as { sport: string; positions: SportPosition[] } }
}

beforeEach(() => {
  calls = []
  respond = () => jsonResponse({ positions: [] })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return respond(url)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('GET /api/sports/:sport/positions — the happy read', () => {
  test('asks the engine for the pack and returns the cleaned list', async () => {
    respond = () =>
      jsonResponse({
        positions: [
          { id: ' point_guard ', label: ' Point Guard ', description: 'Runs the offense.' },
          { id: 'center', label: 'Center' },
        ],
      })
    const res = await ask('basketball')
    expect(res.status).toBe(200)
    expect(res.body.sport).toBe('basketball')
    expect(res.body.positions).toEqual([
      { id: 'point_guard', label: 'Point Guard', description: 'Runs the offense.' },
      { id: 'center', label: 'Center', description: '' },
    ])
    expect(calls.length).toBe(1)
    expect(calls[0]!.url).toEndWith('/sports/basketball/positions')
  })

  test('a second read inside the hour is served from cache without touching the engine', async () => {
    respond = () => jsonResponse({ positions: [{ id: 'pg', label: 'Point Guard' }] })
    const first = await ask('cricket')
    const second = await ask('cricket')
    expect(second.body).toEqual(first.body)
    expect(calls.length).toBe(1)
  })

  test('the client request id is forwarded to the engine, and generated when absent', async () => {
    await ask('hockey', { headers: { 'x-request-id': 'req-abc' } })
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers['x-request-id']).toBe('req-abc')

    await ask('lacrosse')
    const generated = (calls[1]!.init!.headers as Record<string, string>)['x-request-id']
    expect(generated).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('GET /api/sports/:sport/positions — the degradation branch', () => {
  test('a non-2xx from the engine degrades to an empty list with 200, not a 5xx', async () => {
    respond = () => jsonResponse({ detail: 'engine exploded' }, 503)
    const res = await ask('baseball')
    // 200 + [] is the whole contract: the roster form still renders. A test that
    // only asserted "not 500" would pass against an empty body too, so the shape
    // is pinned as well.
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sport: 'baseball', positions: [] })
    expect(calls.length).toBe(1)
  })

  test('an unreachable engine degrades to an empty list with 200', async () => {
    respond = () => {
      throw new TypeError('fetch failed')
    }
    const res = await ask('softball')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sport: 'softball', positions: [] })
  })

  test('a network-level hang (AbortError) also degrades rather than surfacing', async () => {
    respond = () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    const res = await ask('rugby')
    expect(res.status).toBe(200)
    expect(res.body.positions).toEqual([])
  })

  test('the CACHE keeps serving real positions through an engine outage', async () => {
    // The quiet failure in its most valuable form: the pack was fetched once,
    // and an hour of engine downtime costs the roster form nothing — while a
    // naive implementation would have emptied every dropdown.
    respond = () => jsonResponse({ positions: [{ id: 'pitcher', label: 'Pitcher' }] })
    await ask('volleyball')
    expect(calls.length).toBe(1)

    respond = () => {
      throw new TypeError('fetch failed')
    }
    const duringOutage = await ask('volleyball')
    expect(duringOutage.status).toBe(200)
    expect(duringOutage.body.positions).toEqual([{ id: 'pitcher', label: 'Pitcher', description: '' }])
    // A fresh entry short-circuits BEFORE the fetch, so the engine is not
    // consulted at all while the hour lasts. That is the whole value of the
    // cache here, and it is also why the degradation below is invisible: an
    // engine outage produces no failed request, no log line and no empty list.
    expect(calls.length).toBe(1)
  })

  test('a 2xx body whose `positions` is not an array is cached AS EMPTY for the hour', async () => {
    // The one degradation that is genuinely sticky: `cache.set` runs on any 2xx,
    // so one malformed engine response blanks this sport for every client until
    // the TTL lapses. Pinned so the behaviour is a decision on record, not a
    // surprise.
    respond = () => jsonResponse({ positions: { not: 'a list' } })
    const first = await ask('golf')
    expect(first.body.positions).toEqual([])
    respond = () => jsonResponse({ positions: [{ id: 'caddie', label: 'Caddie' }] })
    const cached = await ask('golf')
    expect(cached.body.positions).toEqual([])
    expect(calls.length).toBe(1)
  })

  test('a 2xx body that is not JSON degrades instead of throwing', async () => {
    respond = () => new Response('<html>proxy error</html>', { status: 200 })
    const res = await ask('rugbyunion')
    expect(res.status).toBe(200)
    expect(res.body.positions).toEqual([])
  })

  test('entries that are malformed are dropped, not passed through to the roster form', async () => {
    respond = () =>
      jsonResponse({
        positions: [
          { id: 'keeper', label: 'Keeper' },
          { id: '', label: 'Blank id' },
          { id: 'no_label' },
          null,
          'a string',
          ['an', 'array'],
          { id: '   ', label: 'Whitespace id' },
          { id: 'ok', label: 'Fine', description: 42 },
        ],
      })
    const res = await ask('handball')
    expect(res.body.positions).toEqual([
      { id: 'keeper', label: 'Keeper', description: '' },
      // A non-string description becomes '', never the number — the type is the
      // contract `SportPosition` declares.
      { id: 'ok', label: 'Fine', description: '' },
    ])
  })
})

describe('GET /api/sports/:sport/positions — input normalisation', () => {
  test('a non-alphabetic sport is a 400 with an empty list and no engine call', async () => {
    for (const sport of ['bad-sport', 'bad1', 'bad_sport', '..%2Fetc']) {
      const res = await ask(sport)
      expect(res.status).toBe(400)
      expect(res.body.positions).toEqual([])
    }
    // Nothing reached the engine: a 400 is decided before the fetch.
    expect(calls).toEqual([])
  })

  test('the sport is lower-cased, so `Netball` hits the same cache entry as `netball`', async () => {
    respond = () => jsonResponse({ positions: [{ id: 'sf', label: 'Small Forward' }] })
    const upper = await ask('Netball')
    expect(upper.status).toBe(200)
    expect(upper.body.sport).toBe('netball')
    expect(calls[0]!.url).toEndWith('/sports/netball/positions')
    calls.length = 0
    // …and the lower-cased read is a cache HIT.
    const lower = await ask('netball')
    expect(lower.body.positions).toEqual([{ id: 'sf', label: 'Small Forward', description: '' }])
    expect(calls).toEqual([])
  })

  test('an over-long sport name is truncated to 60 characters before validation', async () => {
    const long = 'a'.repeat(70)
    respond = () => jsonResponse({ positions: [] })
    const res = await ask(long)
    expect(res.status).toBe(200)
    expect(res.body.sport).toHaveLength(60)
    expect(calls[0]!.url).toEndWith(`/sports/${'a'.repeat(60)}/positions`)
  })
})