import { afterEach, describe, expect, test } from 'bun:test'
import type { SQL } from 'bun'

import {
  ensureInitialized,
  isConnectionError,
  orDisabledDefault,
  setHistoryStoreConnectionForTests,
  withHistoryStore,
  withHistoryStoreOrThrow,
} from '../src/lib/historyStore'
import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Stub connection ─────────────────────────────────────────────────────────
// Pins the wrapper's guarantees without a live DB: the seam swaps `sql`, and
// the stub counts connect/DDL work so tests can assert ordering and
// single-init under concurrency.

type StubState = { connects: number; ddlStatements: number }

const makeStubConnection = (state: StubState): SQL => {
  const tag = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
    state.ddlStatements += 1
    return Promise.resolve([])
  }) as unknown as SQL
  const stub = tag as unknown as SQL
  // Attached via Object.assign (not property assignment) so the stub's
  // intentionally-partial members aren't checked against SQL's overloaded
  // signatures — the stub implements exactly what ensureInitialized uses
  // (template call, connect, unsafe, close), nothing more.
  Object.assign(stub, {
    connect: async () => {
      state.connects += 1
      // Yield so concurrent wrapper calls interleave the way they do in prod.
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    unsafe: async () => [],
    close: async () => {},
  })
  return stub
}

let restoreConnection: (() => void) | null = null

const useStub = (): StubState => {
  const state: StubState = { connects: 0, ddlStatements: 0 }
  restoreConnection = setHistoryStoreConnectionForTests(makeStubConnection(state))
  return state
}

afterEach(() => {
  restoreConnection?.()
  restoreConnection = null
})

describe('wrapper owns schema initialization', () => {
  test('initializes the schema BEFORE invoking the callback', async () => {
    const state = useStub()
    let observedConnects = -1
    let observedDdl = -1

    const result = await withHistoryStore(async () => {
      observedConnects = state.connects
      observedDdl = state.ddlStatements
      return 'ran'
    })

    expect(result).toBe('ran')
    expect(observedConnects).toBe(1)
    expect(observedDdl).toBeGreaterThan(0)
  })

  test('initializes exactly ONCE under concurrent wrapper calls', async () => {
    const state = useStub()

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withHistoryStore(async () => {
          // Every callback must observe a fully initialized schema.
          expect(state.connects).toBe(1)
          expect(state.ddlStatements).toBeGreaterThan(0)
          return i
        }),
      ),
    )

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(state.connects).toBe(1)
  })

  test('orThrow variant shares the same init guarantee (once, before callback)', async () => {
    const state = useStub()

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        withHistoryStoreOrThrow(async () => {
          expect(state.connects).toBe(1)
          return i
        }),
      ),
    )

    expect(results).toEqual([0, 1, 2, 3])
    expect(state.connects).toBe(1)
  })

  test('ensureInitialized stays idempotent across sequential wrapper calls', async () => {
    const state = useStub()

    await withHistoryStore(async () => 1)
    await withHistoryStore(async () => 2)
    await ensureInitialized()

    expect(state.connects).toBe(1)
  })
})

describe('degradation policy (single home: orDisabledDefault)', () => {
  test('disabled store: wrapped query yields the documented default', async () => {
    restoreConnection = setHistoryStoreConnectionForTests(null)

    const rows = orDisabledDefault(await withHistoryStore(async () => ['never']), [])
    expect(rows).toEqual([])

    const ok = orDisabledDefault(await withHistoryStore(async () => true), false)
    expect(ok).toBe(false)
  })

  test('disabled store: OrThrow surfaces the configuration error', async () => {
    restoreConnection = setHistoryStoreConnectionForTests(null)

    expect(withHistoryStoreOrThrow(async () => 1)).rejects.toThrow(
      'History store is not configured (DATABASE_URL not set)',
    )
  })

  test('enabled store: callback results pass through unchanged', () => {
    expect(orDisabledDefault('value', 'fallback')).toBe('value')
    expect(orDisabledDefault(null, 'fallback')).toBe('fallback')
    expect(orDisabledDefault(undefined, 'fallback')).toBe('fallback')
  })
})

// ── Live init (needs a configured database) ─────────────────────────────────
describeLiveDb('historyStore live initialization', () => {
  // Points the store at the resolved URL and resets `initPromise` with it, so
  // the concurrent callers below all race through a REAL first init rather than
  // returning whatever a previous connection already memoised.
  useLiveTestDb()

  test(
    'concurrent wrapper calls all observe an initialized schema',
    async () => {
      const seen = await Promise.all(
        Array.from({ length: 5 }, () =>
          withHistoryStore(async (db) => {
            const rows = await db<{ ok: boolean }[]>`
              select to_regclass('public.notifications') is not null
                and to_regclass('public.students') is not null as ok;
            `
            return rows?.[0]?.ok ?? false
          }),
        ),
      )
      expect(seen.every(Boolean)).toBe(true)
    },
    { timeout: 60000 },
  )
})

describe('isConnectionError (reconnect predicate)', () => {
  const coded = (code: string, message = 'x') => Object.assign(new Error(message), { code })

  test('matches the Bun connection-error code family', () => {
    for (const code of [
      'ERR_POSTGRES_CONNECTION_CLOSED',
      'ERR_POSTGRES_CONNECTION_FAILED',
      'ERR_POSTGRES_CONNECTION_REFUSED',
      'ERR_POSTGRES_CONNECTION_TIMEOUT',
      'ERR_POSTGRES_IDLE_TIMEOUT',
      'ERR_POSTGRES_LIFETIME_TIMEOUT',
    ]) {
      expect(isConnectionError(coded(code))).toBe(true)
    }
  })

  test('matches Postgres restart / broken-connection codes', () => {
    for (const code of ['57P01', '57P02', '57P03', '08000', '08003', '08006']) {
      expect(isConnectionError(coded(code))).toBe(true)
    }
  })

  test('never matches statement errors, even with alarming messages', () => {
    expect(isConnectionError(coded('23505', 'duplicate key Connection closed'))).toBe(false)
    expect(isConnectionError(coded('42601', 'syntax error'))).toBe(false)
    expect(isConnectionError(coded('ERR_POSTGRES_QUERY_CANCELLED', 'cancelled'))).toBe(false)
  })

  test('message sniff is case-insensitive and covers errno spellings', () => {
    expect(isConnectionError(new Error('connection closed by server'))).toBe(true)
    expect(isConnectionError(new Error('Connection timeout after 3s'))).toBe(true)
    expect(isConnectionError(new Error('read ECONNRESET'))).toBe(true)
    expect(isConnectionError(new Error('duplicate key value'))).toBe(false)
  })
})

describe('reconnect-and-retry (stubbed)', () => {
  const codedFailure = (code: string) => {
    const err = new Error(`stub ${code}`) as Error & { code: string }
    err.code = code
    return err
  }

  test('connection-coded callback failure retries once on a fresh init and succeeds', async () => {
    useStub()
    let attempts = 0

    const result = await withHistoryStore(async () => {
      attempts += 1
      if (attempts === 1) throw codedFailure('ERR_POSTGRES_CONNECTION_CLOSED')
      return 'recovered'
    })

    expect(result).toBe('recovered')
    expect(attempts).toBe(2)
  })

  test('statement-coded callback failure never retries (no double-apply risk)', async () => {
    useStub()
    let attempts = 0

    const result = await withHistoryStore(async () => {
      attempts += 1
      throw codedFailure('23505')
    })

    expect(result).toBeNull()
    expect(attempts).toBe(1)
  })
})
