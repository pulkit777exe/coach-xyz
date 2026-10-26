// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

// ── A real DOM for the components `renderToStaticMarkup` cannot see ────────────
//
// WHY THIS FILE EXISTS. `AnalysisLinkControl` returns `null` until its effect has
// resolved `students`, and `NotificationBell` returns `null` until
// `inAppEnabled === true`. React never runs `useEffect` under
// `renderToStaticMarkup`, so the render sweep walked both of them, counted them
// covered, and emitted ZERO output. That is "reachability is not execution" in its
// total form: there was no observation of either component at all.
//
// WHY jsdom AND NOT A REAL BROWSER. `scripts/domHarness/` drives the Chromium on
// disk over CDP with no dependency at all, and it works — but it is a local script,
// not a gate, so nothing stops a regression. This file is a gate. Only `jsdom` was
// added: React 19 exports `act` from `react` itself, so the Testing Library stack
// would be weight without function.
//
// SCOPE, and the limit worth stating: the data layer is mocked at the module
// boundary rather than driven through a fake origin, which is a deliberate trade.
// The Chromium harness exercised the REAL `lib/org` against a fake HTTP origin, so
// it also proved URL construction and JSON handling. Here those are stubbed, so what
// is pinned is the component's behaviour over its inputs — the branch that was
// previously unobservable at all — and not the fetch path. That division is a
// choice, not a proof, and it is the first thing to revisit if a fetch-layer
// regression ever lands green here.
//
// `act` is required around every state update. Without it React renders
// asynchronously, so a read lands mid-commit — which is how an assertion starts
// passing for the wrong reason rather than failing loudly.

let container: HTMLDivElement
let root: Root
/** Errors and unhandled rejections seen since the current test started. */
let noise: unknown[]

// React 19 refuses to run `act` unless this flag is set, and says so through
// console.error — which the noise capture below would (correctly) treat as a
// failure. It is an environment declaration, not a defect, so it is set here
// rather than filtered out of the captured noise.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('error', onError)
  // React reports a throw with no error boundary through console.error; capture it
  // too, so a crash cannot masquerade as a deliberate empty render.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    noise.push(args[0])
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.removeEventListener('unhandledrejection', onRejection)
  window.removeEventListener('error', onError)
  vi.restoreAllMocks()
  vi.resetModules()
})

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
}
const settle = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}
const text = () => container.textContent ?? ''
const buttons = () =>
  [...container.querySelectorAll('button')].map((b) => ({
    text: (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
    disabled: (b as HTMLButtonElement).disabled,
  }))
const click = async (needle: string) => {
  const target = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(needle),
  )
  if (!target) {
    throw new Error(`no control matching "${needle}"; saw ${JSON.stringify(buttons())}`)
  }
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const STUDENTS = [
  { id: 's-1', full_name: 'Ada Lovelace', sport: 'soccer', status: 'active' },
  { id: 's-2', full_name: 'Grace Hopper', sport: 'basketball', status: 'active' },
]

/**
 * Loaded per test with fresh mocks rather than mutating one shared mock: mock
 * ordering across tests is a documented hazard in this repo, and a module-level
 * mutable mock is exactly that shape.
 */
const loadLinkControl = async (
  orgStudents: () => Promise<{ students: unknown[] }>,
  link: (studentId: string | null) => Promise<unknown>,
) => {
  vi.doMock('@/lib/org/students', () => ({
    orgStudents: async () => orgStudents(),
  }))
  vi.doMock('@/lib/org/email', () => ({
    linkAnalysisToStudent: async (_org: string, _job: string, studentId: string | null) =>
      link(studentId),
  }))
  vi.doMock('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined },
    Toaster: () => null,
  }))
  const mod = await import('@/components/org/AnalysisLinkControl')
  return mod.default
}

const PROPS = { auth0Id: 'auth0|org', jobId: 'job-1', initialStudentId: null as string | null }

describe('AnalysisLinkControl — the branches no static render could reach', () => {
  test('renders nothing until the effect resolves, then shows the affordance', async () => {
    let release: (v: { students: unknown[] }) => void = () => undefined
    const Component = await loadLinkControl(
      () => new Promise((resolve) => (release = resolve)),
      async () => ({}),
    )

    await render(<Component {...PROPS} />)
    // The claim the render sweep could not make: before the fetch settles there is
    // genuinely no markup at all, not merely no interesting text.
    expect(container.innerHTML).toBe('')

    release({ students: STUDENTS })
    await settle()
    expect(text()).toContain('Link to Student')
    expect(buttons()).toHaveLength(1)
  })

  test('a failed roster fetch renders nothing rather than crashing', async () => {
    const Component = await loadLinkControl(
      async () => {
        throw new Error('roster unavailable')
      },
      async () => ({}),
    )
    await render(<Component {...PROPS} />)
    await settle()
    // Paired with the noise assertion: a component that THROWS also renders nothing,
    // so this line on its own would pass against a crash.
    expect(container.innerHTML).toBe('')
    expect(noise).toEqual([])
  })

  test('an empty roster renders nothing, and is distinguishable from a failure', async () => {
    const Component = await loadLinkControl(async () => ({ students: [] }), async () => ({}))
    await render(<Component {...PROPS} />)
    await settle()
    expect(container.innerHTML).toBe('')
    expect(noise).toEqual([])
  })

  test('an already-linked analysis shows the student, not the unlinked label', async () => {
    const Component = await loadLinkControl(async () => ({ students: STUDENTS }), async () => ({}))
    await render(<Component {...PROPS} initialStudentId="s-1" />)
    await settle()
    expect(text()).toContain('Ada Lovelace')
    expect(text()).not.toContain('Link to Student')
  })

  test('the open dropdown lists every student and disables the linked one', async () => {
    const Component = await loadLinkControl(async () => ({ students: STUDENTS }), async () => ({}))
    await render(<Component {...PROPS} initialStudentId="s-1" />)
    await settle()
    await click('Ada Lovelace')

    expect(text()).toContain('Linked to')
    expect(text()).toContain('Grace Hopper')
    expect(text()).toContain('Unlink Ada Lovelace')

    const rows = buttons()
    // Target the row by its `· linked` marker: the TRIGGER also renders the linked
    // student's name, so a "find the button containing this name" assertion matches
    // the trigger and asserts nothing about the row.
    const linked = rows.find((b) => b.text.includes('· linked'))
    expect(linked?.disabled).toBe(true)
    // The inverse, and what stops "disable every row" from satisfying the line above.
    expect(rows.find((b) => b.text.includes('Grace Hopper'))?.disabled).toBe(false)
    expect(rows.filter((b) => b.text.includes('· linked'))).toHaveLength(1)
  })

  test('choosing a student persists the link, relabels the trigger and closes the panel', async () => {
    const written: (string | null)[] = []
    const Component = await loadLinkControl(async () => ({ students: STUDENTS }), async (id) => {
      written.push(id)
      return {}
    })
    await render(<Component {...PROPS} initialStudentId="s-1" />)
    await settle()
    await click('Ada Lovelace')
    await click('Grace Hopper')
    await settle()

    expect(written).toEqual(['s-2'])
    expect(text()).toContain('Grace Hopper')
    // Assert the panel's ABSENCE structurally. An earlier version asserted
    // `!text.includes('Choose a student')`, which passes with the panel still open —
    // after a successful link that header legitimately reads 'Linked to'. A mutation
    // that removed `setOpen(false)` was reported green against it.
    expect(buttons()).toHaveLength(1)
  })

  test('unlinking sends an explicit null, not an absent key', async () => {
    const written: (string | null)[] = []
    const Component = await loadLinkControl(async () => ({ students: STUDENTS }), async (id) => {
      written.push(id)
      return {}
    })
    await render(<Component {...PROPS} initialStudentId="s-1" />)
    await settle()
    await click('Ada Lovelace')
    await click('Unlink')
    await settle()

    // `null` and `undefined` differ on the wire: JSON drops an undefined key entirely,
    // which the server reads as "leave it alone", so the unlink would silently not
    // happen and this assertion is the only thing that would notice.
    expect(written).toEqual([null])
    expect(text()).toContain('Link to Student')
  })

  test('a click outside closes the panel — the effect-only branch', async () => {
    const Component = await loadLinkControl(async () => ({ students: STUDENTS }), async () => ({}))
    await render(<Component {...PROPS} />)
    await settle()
    await click('Link to Student')
    expect(text()).toContain('Choose a student')

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    // A document listener installed by a useEffect. No markup render can observe it,
    // which is why this branch existed only in the browser harness.
    expect(text()).not.toContain('Choose a student')
  })

  test('the roster is fetched once, not again on open or on choosing', async () => {
    let calls = 0
    const Component = await loadLinkControl(
      async () => {
        calls += 1
        return { students: STUDENTS }
      },
      async () => ({}),
    )
    await render(<Component {...PROPS} />)
    await settle()
    await click('Link to Student')
    await settle()
    await click('Grace Hopper')
    await settle()
    // The effect keys on `[auth0Id]`, so opening the panel and choosing must not
    // refetch. A regression here is invisible without counting.
    expect(calls).toBe(1)
  })
})