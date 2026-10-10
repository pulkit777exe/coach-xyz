// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

// ── TeamsClient: a write's follow-up read must not answer for another team ────
//
// Four write handlers (remove member, add member, remove match, add match) capture
// `selected.id` when clicked, re-read that team's list once the write lands, and
// `setMembers` / `setMatches` directly. The team rail is NOT disabled while `busy`,
// so a coach can switch teams mid-write — and the follow-up response then arrives
// for the team they LEFT.
//
// That is a cross-entity stale write, and it PERSISTS: the panel effect for team B
// has already settled (`panelLoadedFor === B`), so nothing ever re-reads and team B's
// panel keeps showing team A's rows. No loading flag hides it either, because
// `panelLoading` is derived from `panelLoadedFor !== selectedId`, which is false.
//
// The panel effect itself already guards with `cancelled`; the write follow-ups had
// no equivalent. `stillOnTeam` is the equivalent, and this file is what keeps the
// four sites honest.
//
// Every read is handed out as a deferred, because the defect is entirely ORDER: the
// abandoned team's response has to arrive after the new team's for the bug to exist.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
type Call = { teamId: string; settled: boolean; finish: (value: unknown) => void }
let memberCalls: Call[]
let matchCalls: Call[]
let trendCalls: Call[]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  memberCalls = []
  matchCalls = []
  trendCalls = []
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => noise.push(a[0]))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.removeEventListener('unhandledrejection', onRejection)
  window.removeEventListener('error', onError)
  vi.restoreAllMocks()
  vi.resetModules()
})

/** Let promise handlers run AND React commit what they set. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

const text = () => document.body.textContent ?? ''

/** `listTeamMembers(auth0Id, teamId)` takes the id as a bare second argument. */
const byIdArg = (args: unknown[]) => String(args[1] ?? '')
/** The rest (`orgMatches`, `getFindingsTrends`) take an options object. */
const byTeamOption = (args: unknown[]) => String((args[1] as { teamId?: string } | undefined)?.teamId ?? '')

const deferred =
  (sink: Call[], pick: (args: unknown[]) => string) =>
  (...args: unknown[]): Promise<unknown> =>
    new Promise((resolve) => {
      sink.push({ teamId: pick(args), settled: false, finish: (value) => resolve(value) })
    })

const next = (sink: Call[], teamId: string) => {
  const hit = sink.find((c) => c.teamId === teamId && !c.settled)
  expect(hit).toBeTruthy()
  return hit!
}

const load = async () => {
  vi.doMock('@/lib/teams', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    listTeamMembers: deferred(memberCalls, byIdArg),
    removeTeamMember: async () => ({}),
    addTeamMember: async () => ({}),
    renameTeam: async () => ({}),
    createTeam: async () => ({}),
    deleteTeam: async () => ({}),
  }))
  vi.doMock('@/lib/org', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    orgMatches: deferred(matchCalls, byTeamOption),
    orgCreateMatch: async () => ({}),
    orgDeleteMatch: async () => ({}),
    orgCreateSeason: async () => ({}),
    orgDeleteSeason: async () => ({}),
  }))
  vi.doMock('@/lib/api', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getFindingsTrends: deferred(trendCalls, byTeamOption),
  }))
  const mod = await import('@/components/org/TeamsClient')
  return mod.default
}

const team = (id: string, name: string) => ({
  id,
  org_auth0_id: 'auth0|org',
  name,
  sport: 'Football',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
})

const matchRow = (id: string, opponent: string) => ({
  id,
  org_auth0_id: 'auth0|org',
  team_id: 'team-a',
  season_id: null,
  opponent,
  match_on: null,
  location: null,
  result: null,
  created_at: '2026-01-01T00:00:00.000Z',
})

const coach = (id: string, teamId: string, who: string) => ({
  id,
  team_id: teamId,
  member_auth0_id: who,
  student_id: null,
  role: 'coach',
  created_at: '2026-01-01T00:00:00.000Z',
})

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
  await settle()
}

const buttonByLabel = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  ) ?? null

/** Member rows and match rows BOTH label their delete button "Remove", so a bare
 *  label match picks whichever the DOM happens to list first. Scope by the text of
 *  the row it sits in, walking a few levels because Button wraps its own element. */
const removeNear = (needle: string) =>
  [...document.body.querySelectorAll('button')].find((b) => {
    if ((b.textContent ?? '').trim() !== 'Remove') return false
    let el: HTMLElement | null = b.parentElement
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      if ((el.textContent ?? '').includes(needle)) return true
    }
    return false
  }) ?? null

/** The member Add button's text is exactly "Add"; "Add match" also CONTAINS it, so
 *  `includes` would return the wrong button. Match exactly. */
const addMemberButton = () =>
  [...document.body.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === 'Add',
  ) ?? null

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

const setInput = async (selector: string, value: string) => {
  const el = document.body.querySelector<HTMLInputElement>(selector)
  expect(el).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(el!, value)
  await act(async () => {
    el!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

/** Answer the panel effect's three reads for one team. */
const settlePanelFor = async (teamId: string, members: unknown[], matches: unknown[]) => {
  const m = next(memberCalls, teamId)
  const t = next(trendCalls, teamId)
  const x = next(matchCalls, teamId)
  m.settled = true
  t.settled = true
  x.settled = true
  await act(async () => {
    m.finish({ members })
    t.finish({ trends: [] })
    x.finish({ matches })
  })
  await settle()
}

describe('TeamsClient — a write follow-up must not answer for another team', () => {
  test('team B’s panel keeps team B’s matches after a team-A write lands late', async () => {
    const TeamsClient = await load()
    await render(
      <TeamsClient
        auth0Id="auth0|org"
        initialTeams={[team('team-a', 'A Squad'), team('team-b', 'B Squad')]}
        initialSeasons={[]}
        students={[]}
        canManage
        canDeleteTeam={false}
      />,
    )

    // Panel settles for team A (the initially selected team).
    await settlePanelFor('team-a', [coach('m1', 'team-a', 'a-member')], [
      matchRow('ma1', 'A base opponent'),
    ])
    expect(text()).toContain('A base opponent')

    await setInput('input[aria-label="Opponent"]', 'Rivals')
    await click(buttonByLabel('Add match'))
    // The write resolved, so the follow-up `orgMatches(team-a)` is now in flight.
    const teamAFollowUps = matchCalls.filter((c) => c.teamId === 'team-a')
    expect(teamAFollowUps).toHaveLength(2)
    const followUp = teamAFollowUps[1]

    // Switch teams WHILE that follow-up is still pending. The rail is not disabled
    // during `busy`, which is exactly why the guard has to exist.
    await click(buttonByLabel('B Squad'))
    await settlePanelFor('team-b', [coach('m2', 'team-b', 'b-member')], [
      matchRow('mb1', 'Correct For B'),
    ])
    expect(text()).toContain('Correct For B')

    // Now the abandoned team-A follow-up arrives — after team B has settled.
    followUp.settled = true
    await act(async () => {
      followUp.finish({ matches: [matchRow('ma2', 'Stale From A')] })
    })
    await settle()

    expect(text()).toContain('Correct For B')
    expect(text()).not.toContain('Stale From A')
    expect(noise).toEqual([])
  })

  test('a follow-up for the team still on screen DOES apply', async () => {
    // Positive control for the guard: it must not simply block every follow-up.
    // Without this, a guard that returned early unconditionally would pass above.
    const TeamsClient = await load()
    await render(
      <TeamsClient
        auth0Id="auth0|org"
        initialTeams={[team('team-a', 'A Squad'), team('team-b', 'B Squad')]}
        initialSeasons={[]}
        students={[]}
        canManage
        canDeleteTeam={false}
      />,
    )
    await settlePanelFor('team-a', [], [matchRow('ma1', 'A base opponent')])

    await setInput('input[aria-label="Opponent"]', 'Rivals')
    await click(buttonByLabel('Add match'))
    const followUp = matchCalls.filter((c) => c.teamId === 'team-a')[1]

    followUp.settled = true
    await act(async () => {
      followUp.finish({ matches: [matchRow('ma2', 'Freshly Created')] })
    })
    await settle()

    expect(text()).toContain('Freshly Created')
    expect(text()).not.toContain('A base opponent')
    expect(noise).toEqual([])
  })

  // ── The other three write paths ────────────────────────────────────────────
  // The two tests above drive ONLY `Add match`, so three of the four
  // `stillOnTeam` guards were correct but unpinned: deleting the guard at the
  // remove-member, add-member or remove-match site left every test green. Measured
  // per site, not assumed — all four mutations ran, and only `Add match` was
  // caught. A comment claiming to keep "the four sites honest" while pinning one
  // is the same defect as a flag that exists but is never consumed.

  /** Render both teams and settle team A with one member and one match. */
  const startOnTeamA = async () => {
    const TeamsClient = await load()
    await render(
      <TeamsClient
        auth0Id="auth0|org"
        initialTeams={[team('team-a', 'A Squad'), team('team-b', 'B Squad')]}
        initialSeasons={[]}
        students={[]}
        canManage
        canDeleteTeam={false}
      />,
    )
    await settlePanelFor('team-a', [coach('m1', 'team-a', 'a-member')], [
      matchRow('ma1', 'A base opponent'),
    ])
  }

  /** Switch to team B and settle it, while a team-A follow-up is still in flight. */
  const leaveForTeamB = async () => {
    await click(buttonByLabel('B Squad'))
    await settlePanelFor('team-b', [coach('m2', 'team-b', 'b-member')], [
      matchRow('mb1', 'Correct For B'),
    ])
    expect(text()).toContain('b-member')
    expect(text()).toContain('Correct For B')
  }

  /** Land the abandoned team-A follow-up and assert team B was not repainted. */
  const expectStaleIgnored = async (followUp: Call, finish: () => void, stale: string) => {
    followUp.settled = true
    await act(async () => {
      finish()
    })
    await settle()

    expect(text()).toContain('b-member')
    expect(text()).toContain('Correct For B')
    expect(text()).not.toContain(stale)
    expect(noise).toEqual([])
  }

  test('a remove-MEMBER follow-up for a team left mid-write does not repaint it', async () => {
    await startOnTeamA()

    // The row-scoped selector matters here: matches also label their button "Remove".
    await click(removeNear('a-member'))
    const followUps = memberCalls.filter((c) => c.teamId === 'team-a')
    expect(followUps).toHaveLength(2)
    const followUp = followUps[1]

    await leaveForTeamB()

    await expectStaleIgnored(
      followUp,
      () => followUp.finish({ members: [coach('stale', 'team-a', 'Stale Member From A')] }),
      'Stale Member From A',
    )
  })

  test('an add-MEMBER follow-up for a team left mid-write does not repaint it', async () => {
    await startOnTeamA()

    // `addKind` defaults to 'player', whose picker is a Select over the roster.
    // Switch to the coach variant, which is a plain input. SelectContent is
    // portal-only, so its options exist only while the trigger is open.
    const kindTrigger = document.body.querySelector<HTMLElement>('button[aria-label="Member kind"]')
    expect(kindTrigger).not.toBeNull()
    await act(async () => {
      kindTrigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    const coachOption = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => (o.textContent ?? '').includes('Coach'),
    )
    expect(coachOption).not.toBeNull()
    await act(async () => {
      // Base UI's option selects on POINTERDOWN, not on click: dispatching only
      // `click` left `addKind` at 'player' and the input never rendered.
      coachOption!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      coachOption!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      coachOption!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      coachOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    await setInput('input[aria-label="Coach member id"]', 'auth0|new-coach')
    await click(addMemberButton())
    const followUps = memberCalls.filter((c) => c.teamId === 'team-a')
    expect(followUps).toHaveLength(2)
    const followUp = followUps[1]

    await leaveForTeamB()

    await expectStaleIgnored(
      followUp,
      () => followUp.finish({ members: [coach('stale', 'team-a', 'Stale Member From A')] }),
      'Stale Member From A',
    )
  })

  test('a remove-MATCH follow-up for a team left mid-write does not repaint it', async () => {
    await startOnTeamA()

    await click(removeNear('A base opponent'))
    const followUps = matchCalls.filter((c) => c.teamId === 'team-a')
    expect(followUps).toHaveLength(2)
    const followUp = followUps[1]

    await leaveForTeamB()

    await expectStaleIgnored(
      followUp,
      () => followUp.finish({ matches: [matchRow('ma2', 'Stale From A')] }),
      'Stale From A',
    )
  })
})
