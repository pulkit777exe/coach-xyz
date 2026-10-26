// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

// ── SidebarSearch: a search abandoned by the reset branch was not invalidated ──
//
// The debounced player search guards each attempt with `seq.current !== my`, so
// only the newest attempt may apply its answer. But the debounce's RESET branch
// (palette closed, or the query dropped below the 2-char floor) cleared `players`
// WITHOUT bumping `seq` — it abandoned the in-flight request while leaving the
// token that request had captured still matching. So the abandoned response landed
// afterwards and painted rows for a query that was no longer on screen.
//
// `GlobalSearch.tsx` already bumps its counter in the equivalent branch; this is
// the same rule arriving in its sibling palette.
//
// `@/lib/org` is mocked WHOLE (spread of `importOriginal`) so a sibling import in
// this component cannot turn a stub into `undefined` at the moment it is called.
// The responses are handed out as deferreds, because the defect is entirely about
// ORDER: the abandoned response has to arrive after the reset for the bug to exist.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
/** Every `orgStudents` call, in order, with its deferred settlement handles. */
let pending: {
  search: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}[]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  pending = []
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
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

/** Run the debounce (200ms) for real, inside act so the timeout's setState commits. */
const tick = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const text = () => document.body.textContent ?? ''

const load = async () => {
  vi.doMock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
  }))
  vi.doMock('@/lib/org', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    orgStudents: (_auth0Id: string, opts: { search?: string }) =>
      new Promise((resolve, reject) => {
        pending.push({ search: opts?.search ?? '', resolve, reject })
      }),
  }))
  const mod = await import('@/components/SidebarSearch')
  return mod.default
}

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
  await settle()
}

/**
 * Open the palette through the component's own ⌘K/Ctrl+K handler rather than
 * through Base UI's pointer protocol — the handler is the path a keyboard user
 * takes, and it keeps this test about state rather than about menu internals.
 */
const openPalette = async () => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  })
  await settle()
}

const type = async (value: string) => {
  const el = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Search pages and players"]',
  )
  expect(el).not.toBeNull()
  // React tracks the DOM node's value, so the native setter must be used or the
  // dispatched `input` event is a no-op against what React believes is already there.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(el!, value)
  await act(async () => {
    el!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

const resolveAt = async (index: number, value: unknown) => {
  await act(async () => {
    pending[index].resolve(value)
  })
  await settle()
}

describe('SidebarSearch — an abandoned search must not answer later', () => {
  test('a search still current DOES paint its result', async () => {
    // Positive control. Without this, the case below would also pass if the stub
    // never rendered anything at all — i.e. if the test were failing to look.
    const Search = await load()
    await render(<Search auth0Id="auth0|org" />)
    await openPalette()
    await type('ab')
    await tick(250)
    expect(pending).toHaveLength(1)
    expect(pending[0].search).toBe('ab')

    await resolveAt(0, { students: [{ id: 's1', full_name: 'Live Player' }] })

    expect(text()).toContain('Live Player')
    expect(noise).toEqual([])
  })

  test('a response for a query dropped below the floor does NOT paint', async () => {
    const Search = await load()
    await render(<Search auth0Id="auth0|org" />)
    await openPalette()
    await type('ab')
    await tick(250)
    expect(pending).toHaveLength(1)

    // Drop back to a single character: the debounce's reset branch runs and clears
    // `players`, but (before the fix) leaves `seq` at the value 'ab' captured.
    await type('a')
    await tick(250)

    // …so the abandoned response arrives after the reset and, unfixed, matches.
    await resolveAt(0, { students: [{ id: 's9', full_name: 'Stale Player' }] })

    expect(text()).not.toContain('Stale Player')
    expect(noise).toEqual([])
  })

  test('a response abandoned by re-opening the palette does NOT paint', async () => {
    // Same defect through the other door: closing and re-opening resets the query
    // and the players list, and used to leave the previous session's request still
    // matching the token it captured.
    //
    // Two things make this observable rather than accidentally green. (1) Nothing
    // here waits out the 200ms debounce, so the reset branch never runs and this
    // case is about `setOpenState` alone. (2) A single character is typed BEFORE the
    // response lands, because with an empty query the twelve static page rows alone
    // fill the `slice(0, 12)` cap and a stale player row would be dropped from the
    // render no matter what the state says — which is how an earlier version of this
    // case passed against the unfixed component.
    const Search = await load()
    await render(<Search auth0Id="auth0|org" />)
    await openPalette()
    await type('ab')
    await tick(250)
    expect(pending).toHaveLength(1)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    })
    await settle()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    })
    await settle()
    await type('a')

    await resolveAt(0, { students: [{ id: 's9', full_name: 'Stale Player' }] })

    expect(text()).not.toContain('Stale Player')
    expect(noise).toEqual([])
  })
})
