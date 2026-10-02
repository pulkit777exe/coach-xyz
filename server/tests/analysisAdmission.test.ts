import { describe, expect, test } from 'bun:test'

import {
  admitAnalysis,
  analysisPriority,
  type AnalysisAdmissionDeps,
} from '../src/lib/analysisAdmission'
import type { OrgTier } from '../src/lib/analyses'
import { describeLiveDb, useLiveTestDb } from './liveDb'

// ── Analysis admission formula ──────────────────────────────────────────────
// One module owns the §17 gate both admission sites share (quota → tier →
// priority → usage); the sites differ only in their base priority —
// /api/analyze uses 5, /api/me/analyze uses 10. Deps are injected so the
// formula is testable without a DB (same pattern as ShareRouteDeps).

const ORG = 'auth0|org-1'
const QUOTA_MESSAGE = 'Organization daily analysis limit reached. Try again tomorrow.'

const makeDeps = (
  opts: {
    reserve?: { total: number } | 'capped' | null
    reserveThrows?: boolean
    tier?: OrgTier
    tierThrows?: boolean
    usageRejects?: boolean
  } = {},
): { deps: AnalysisAdmissionDeps; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    deps: {
      tryReserveUsage: async (orgAuth0Id, kind) => {
        calls.push(`reserve:${orgAuth0Id}:${kind}`)
        if (opts.reserveThrows) throw new Error('reservation store unavailable')
        if (opts.reserve === undefined) return { total: 1 }
        if (opts.reserve === 'capped') return { capped: true }
        return opts.reserve
      },
      getOrgTier: async (orgAuth0Id) => {
        calls.push(`tier:${orgAuth0Id}`)
        if (opts.tierThrows) throw new Error('tier lookup failed')
        return opts.tier ?? 'free'
      },
      recordUsage: async (orgAuth0Id, kind) => {
        calls.push(`usage:${orgAuth0Id}:${kind}`)
        if (opts.usageRejects) throw new Error('usage ledger unavailable')
      },
    },
  }
}

const freshSet = (): { status?: number | string } => ({})

describe('analysisPriority (pure formula)', () => {
  test('/api/analyze lane (base 5): free → 5, pro → 10, elite → 15', () => {
    expect(analysisPriority(5, 'free')).toBe(5)
    expect(analysisPriority(5, 'pro')).toBe(10)
    expect(analysisPriority(5, 'elite')).toBe(15)
  })

  test('/api/me/analyze lane (base 10): free → 10, pro → 15, elite → 20', () => {
    expect(analysisPriority(10, 'free')).toBe(10)
    expect(analysisPriority(10, 'pro')).toBe(15)
    expect(analysisPriority(10, 'elite')).toBe(20)
  })
})

describe('admitAnalysis', () => {
  test('runs reserve → tier → usage in order with base 5 (analyze lane)', async () => {
    const { deps, calls } = makeDeps({ tier: 'pro' })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 5, set, deps })
    expect(out).toEqual({ ok: true, priority: 10 })
    expect(calls).toEqual([`reserve:${ORG}:analysis`, `tier:${ORG}`, `usage:${ORG}:analysis`])
    expect(set.status).toBeUndefined()
  })

  test('base 10 (me lane) + elite tier → priority 20, same order/keys', async () => {
    const { deps, calls } = makeDeps({ tier: 'elite' })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 10, set, deps })
    expect(out).toEqual({ ok: true, priority: 20 })
    expect(calls).toEqual([`reserve:${ORG}:analysis`, `tier:${ORG}`, `usage:${ORG}:analysis`])
  })

  test('quota capped → identical 429 rejection; tier and usage never touched', async () => {
    const { deps, calls } = makeDeps({ reserve: 'capped' })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 5, set, deps })
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(set.status).toBe(429)
    expect(out.error.code).toBe('RATE_LIMITED')
    expect(out.error.message).toBe(QUOTA_MESSAGE)
    expect(out.error.layer).toBe('server')
    expect(out.error.retryable).toBe(true)
    expect(typeof out.error.retry_after).toBe('number')
    expect(calls).toEqual([`reserve:${ORG}:analysis`])
  })

  test('reservation store unavailable → fail open at base priority (never 429)', async () => {
    const { deps, calls } = makeDeps({ reserve: null })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 5, set, deps })
    expect(out).toEqual({ ok: true, priority: 5 })
    expect(set.status).toBeUndefined()
    expect(calls).toEqual([`reserve:${ORG}:analysis`])
  })

  test('tier lookup failure falls back to free — priority is just the base', async () => {
    const { deps } = makeDeps({ tierThrows: true })
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 10, set: freshSet(), deps })
    expect(out).toEqual({ ok: true, priority: 10 })
  })

  test('usage ledger failure is swallowed — admission still succeeds', async () => {
    const { deps } = makeDeps({ tier: 'pro', usageRejects: true })
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 5, set: freshSet(), deps })
    expect(out).toEqual({ ok: true, priority: 10 })
  })
})

// ── Live atomicity race (needs a configured database) ───────────────────────
// Six concurrent admissions against a cap of 3 through the REAL stores must
// admit exactly 3 — the row-lock-serialized increment cannot over-admit no
// matter how the promises interleave. Unique org per run so parallel/repeat
// runs never share a counter row.
describeLiveDb('admitAnalysis live quota race', () => {
  useLiveTestDb()

  test(
    '6 concurrent admissions at cap 3 → exactly 3 admitted',
    async () => {
      const { tryReserveUsage, getOrgTier, recordUsage } = await import('../src/lib/analyses')
      const previousLimit = process.env.ORG_DAILY_ANALYSIS_LIMIT
      process.env.ORG_DAILY_ANALYSIS_LIMIT = '3'
      try {
        const org = `test-quota-race-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
        const deps = { tryReserveUsage, getOrgTier, recordUsage }
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            admitAnalysis({ orgAuth0Id: org, basePriority: 5, set: {}, deps }),
          ),
        )
        const admitted = results.filter((r) => r.ok)
        const rejected = results.filter((r) => !r.ok)
        expect(admitted).toHaveLength(3)
        expect(rejected).toHaveLength(3)
        for (const r of rejected) {
          if (r.ok) throw new Error('unreachable')
          expect(r.error.code).toBe('RATE_LIMITED')
        }
      } finally {
        if (previousLimit === undefined) delete process.env.ORG_DAILY_ANALYSIS_LIMIT
        else process.env.ORG_DAILY_ANALYSIS_LIMIT = previousLimit
      }
    },
    { timeout: 60000 },
  )
})
