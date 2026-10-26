// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// ── A signed-out view rendered "Clips (0)" over "No clips yet" ────────────────────
//
// The anonymous flow — `app/page.tsx` renders `AppClient` with a null auth0Id, which
// reaches `ChatLayout` with a falsy `scopeId` and mounts `ClipsSection auth0Id={null}` —
// early-returns from `refresh` without reading anything, then rendered the SAME output
// as an account whose clip list is genuinely empty: a count of 0 over "No clips yet —
// mark a time range to revisit it instantly." Two claims, both fabricated: nobody
// fetched a list, and the Save form that instruction points at is gated on `auth0Id`
// and was not on screen.
//
// WHY A THIRD STATE, NOT "HIDE THE SECTION": the heading and body are honest about
// what happened (no read, no count, no persistence promise) without touching the
// ChatLayout wrapper the section sits inside.
//
// The count assertion is the defect, verbatim: `Clips (0)` is the string the old code
// printed. The POSITIVE CONTROL is the same render with an `auth0Id` and a resolved
// empty list — without it, "never render (0)" would be satisfied by deleting the count
// for everyone.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
/** The read the effect performs when — and only when — `auth0Id` is present. */
const listClips = {
  calls: [] as Array<{ auth0Id: string; jobId: string }>,
  ok: true as boolean,
  value: [] as unknown[],
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  listClips.calls = []
  listClips.ok = true
  listClips.value = []
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

const settle = async () => {
  // Two microtask turns: one for the promise chain, one for the React commit that
  // renders what it set.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const load = async () => {
  vi.doMock('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined },
    Toaster: () => null,
  }))
  // SPREAD the real module so a sibling import gaining a name cannot break this stub
  // (the enumerated-mock trap), and replace only the read this component performs.
  vi.doMock('@/lib/library', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    listClips: async (auth0Id: string, jobId: string) => {
      listClips.calls.push({ auth0Id, jobId })
      if (!listClips.ok) throw new Error('clips boom')
      return { clips: listClips.value }
    },
  }))
  const mod = await import('@/components/ClipsSection')
  return mod.default
}

const render = async (auth0Id: string | null) => {
  const ClipsSection = await load()
  await act(async () => {
    root.render(<ClipsSection auth0Id={auth0Id} jobId="job-1" onSeek={() => undefined} />)
  })
  await settle()
  return container.textContent ?? ''
}

describe('ClipsSection — signed out is a third state, not "empty"', () => {
  test('DEFECT: signed out renders no "Clips (0)" and no "No clips yet"', async () => {
    const text = await render(null)
    // The two fabricated claims, verbatim from before the fix.
    expect(text).not.toContain('Clips (0)')
    expect(text).not.toContain('No clips yet')
    // And the replacement says what is actually true: no read happened here.
    expect(text).toContain('Clips are not available in this view.')
    // The heading still names the section — hiding it would be the other dishonest fix.
    expect(text).toContain('Clips')
  })

  test('signed out performs NO read at all', async () => {
    // The reason the count is fabricated: there is no list behind it. Asserting the
    // call count pins the early return, without which a signed-out render would both
    // fetch (against no session) and still have nothing to count.
    await render(null)
    expect(listClips.calls).toEqual([])
  })

  test('control: a signed-in account with a resolved empty list DOES show (0)', async () => {
    // The positive control, using the same assertion the defect case negates. Without
    // it, deleting the count unconditionally would pass the case above.
    const text = await render('auth0|org')
    expect(listClips.calls).toEqual([{ auth0Id: 'auth0|org', jobId: 'job-1' }])
    expect(text).toContain('Clips (0)')
    expect(text).toContain('No clips yet')
    expect(text).not.toContain('Clips are not available in this view.')
  })

  test('control: a signed-in account with saved clips still lists them', async () => {
    // The count is not merely allowed, it is correct — and the list renders under it.
    listClips.value = [
      { id: 'c1', label: 'Release', start_ms: 12_500, end_ms: 15_000 },
    ]
    const text = await render('auth0|org')
    expect(text).toContain('Clips (1)')
    expect(text).toContain('Release')
    expect(text).not.toContain('No clips yet')
  })

  test('a FAILED read keeps its own arm — signed out does not swallow it', async () => {
    // The branch order matters for the same reason every case in
    // `failedReadStates.test.ts` does: a signed-in failure must still say the read
    // failed, never the signed-out copy (which would be a lie about the session) and
    // never the empty copy (the defect that file exists to prevent).
    listClips.ok = false
    const text = await render('auth0|org')
    expect(text).toContain('Clips failed to load.')
    expect(text).not.toContain('Clips are not available in this view.')
    expect(text).not.toContain('No clips yet')
    expect(text).toContain('unavailable')
  })

  test('no unhandled rejection and nothing thrown across all arms', async () => {
    listClips.ok = false
    await render('auth0|org')
    await render(null)
    expect(noise).toEqual([])
  })
})
