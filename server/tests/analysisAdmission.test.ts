import { describe, expect, test } from 'bun:test'

import {
  admitAnalysis,
  analysisPriority,
  type AnalysisAdmissionDeps,
} from '../src/lib/analysisAdmission'
import type { OrgTier } from '../src/lib/analyses'

// ── Analysis admission formula ──────────────────────────────────────────────
// One module owns the §17 gate both admission sites share (quota → tier →
// priority → usage); the sites differ only in their base priority —
// /api/analyze uses 5, /api/me/analyze uses 10. Deps are injected so the
// formula is testable without a DB (same pattern as ShareRouteDeps).

const ORG = 'auth0|org-1'
const QUOTA_MESSAGE = 'Organization daily analysis limit reached. Try again tomorrow.'

const makeDeps = (
  opts: {
    allowed?: boolean
    retryAfterSec?: number
    tier?: OrgTier
    tierThrows?: boolean
    usageRejects?: boolean
  } = {},
): { deps: AnalysisAdmissionDeps; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    deps: {
      checkOrgDailyQuota: async (orgAuth0Id) => {
        calls.push(`quota:${orgAuth0Id}`)
        return { allowed: opts.allowed ?? true, retryAfterSec: opts.retryAfterSec ?? 0 }
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
  test('runs quota → tier → usage in order with base 5 (analyze lane)', async () => {
    const { deps, calls } = makeDeps({ tier: 'pro' })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 5, set, deps })
    expect(out).toEqual({ ok: true, priority: 10 })
    expect(calls).toEqual([`quota:${ORG}`, `tier:${ORG}`, `usage:${ORG}:analysis`])
    expect(set.status).toBeUndefined()
  })

  test('base 10 (me lane) + elite tier → priority 20, same order/keys', async () => {
    const { deps, calls } = makeDeps({ tier: 'elite' })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 10, set, deps })
    expect(out).toEqual({ ok: true, priority: 20 })
    expect(calls).toEqual([`quota:${ORG}`, `tier:${ORG}`, `usage:${ORG}:analysis`])
  })

  test('quota exceeded → identical 429 rejection; tier and usage never touched', async () => {
    const { deps, calls } = makeDeps({ allowed: false, retryAfterSec: 4321 })
    const set = freshSet()
    const out = await admitAnalysis({ orgAuth0Id: ORG, basePriority: 5, set, deps })
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(set.status).toBe(429)
    expect(out.error).toEqual({
      code: 'RATE_LIMITED',
      message: QUOTA_MESSAGE,
      layer: 'server',
      retryable: true,
      retry_after: 4321,
    })
    expect(calls).toEqual([`quota:${ORG}`])
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
