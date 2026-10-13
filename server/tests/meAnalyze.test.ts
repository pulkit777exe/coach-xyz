import { describe, expect, test } from 'bun:test'
import { decidePlayerAnalysis } from '../src/lib/playerScope'

const VERIFIED = 'auth0|player-123'
const COACH = 'auth0|coach-456'

const playerScope = (
  overrides: Partial<Parameters<typeof decidePlayerAnalysis>[0]['playerScope']> = {},
) => ({
  accountAuth0Id: VERIFIED,
  student: { id: 'stu-1' } as { id: string } | null,
  coachAuth0Id: COACH,
  ...overrides,
})

describe('decidePlayerAnalysis', () => {
  test('missing verified identity → 403 Missing verified identity', () => {
    const decision = decidePlayerAnalysis({
      verifiedAuth0Id: null,
      playerScope: playerScope(),
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('unreachable')
    expect(decision.status).toBe(403)
    expect(decision.error.code).toBe('FORBIDDEN')
    expect(decision.error.message).toBe('Missing verified identity')
    expect(decision.error.retryable).toBe(false)
  })

  test('account with no linked student → 403 No linked player account', () => {
    const decision = decidePlayerAnalysis({
      verifiedAuth0Id: VERIFIED,
      playerScope: playerScope({ student: null }),
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('unreachable')
    expect(decision.status).toBe(403)
    expect(decision.error.code).toBe('FORBIDDEN')
    expect(decision.error.message).toBe('No linked player account')
  })

  test('account not linked to any coach org → 403 No linked player account', () => {
    const decision = decidePlayerAnalysis({
      verifiedAuth0Id: VERIFIED,
      playerScope: playerScope({ coachAuth0Id: null }),
    })
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('unreachable')
    expect(decision.status).toBe(403)
    expect(decision.error.code).toBe('FORBIDDEN')
  })

  test('linked player → coach-scoped target + player attribution', () => {
    const decision = decidePlayerAnalysis({
      verifiedAuth0Id: VERIFIED,
      playerScope: playerScope(),
    })
    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('unreachable')
    expect(decision.coachAuth0Id).toBe(COACH)
    // requested_by is the verified player, not the coach-scope account id
    expect(decision.requestedBy).toBe(VERIFIED)
    expect(decision.studentId).toBe('stu-1')
  })

  test('decision is deterministic for a given input', () => {
    const input = { verifiedAuth0Id: VERIFIED, playerScope: playerScope() }
    expect(decidePlayerAnalysis(input)).toEqual(decidePlayerAnalysis(input))
  })
})
