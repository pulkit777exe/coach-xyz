// listStudents archive semantics in a fresh process, isolated from other
// files' `mock.module` stubs. The real listStudents runs against a recording
// stub; the test asserts the archive predicate binds correctly (the filter
// itself is Postgres, which no fixture can prove — the ephemeral probe covers
// the CHECK migration). Prints the bound values per case.

import { mock } from 'bun:test'

const queries: Array<{ sql: string; values: unknown[] }> = []

mock.module('../src/lib/historyStore', () => ({
  withHistoryStoreOrThrow: async (fn: (db: unknown) => unknown) => {
    const db = (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join('?'), values })
      return []
    }
    return fn(db)
  },
  withHistoryStore: async (fn: (db: unknown) => unknown) => fn(() => []),
  orDisabledDefault: <T>(_v: T | null, f: T) => f,
  shutdownHistoryStore: async () => undefined,
  setHistoryStoreConnectionForTests: () => () => undefined,
  ensureInitialized: async () => undefined,
}))

process.env.SERVICE_TOKEN = ''
process.env.DATABASE_URL = ''

const { listStudents } = await import('../src/lib/org/students')

// Locate the archive predicate's bound flag by position: values parallel the
// `?` placeholders, so count the placeholders before the match (never search
// by type — a second boolean anywhere in the list would invalidate it).
const ARCHIVE_PREDICATE = /not \? or status <> 'archived'/
const archiveFlag = (query: { sql: string; values: unknown[] }): unknown => {
  const match = ARCHIVE_PREDICATE.exec(query.sql)
  if (!match) throw new Error(`no archive predicate in: ${query.sql}`)
  return query.values[query.sql.slice(0, match.index).split('?').length - 1]
}

const out: Record<string, unknown> = {}

await listStudents('auth0|org', {})
out.defaultHide = archiveFlag(queries[queries.length - 1])

await listStudents('auth0|org', { includeArchived: true })
out.includeShows = archiveFlag(queries[queries.length - 1])

await listStudents('auth0|org', { status: 'archived' })
out.statusWinsHide = archiveFlag(queries[queries.length - 1])
out.statusWinsValue = queries[queries.length - 1].values.find((v) => v === 'archived') ?? null

await listStudents('auth0|org', { status: 'active', includeArchived: true })
out.explicitActiveHide = archiveFlag(queries[queries.length - 1])

console.log(JSON.stringify(out))
