// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { Finding } from '@/types'

// ── FindingsTimeline: a review WRITE that fails ──────────────────────────────
//
// `review` is `try { await onReview(...) } finally { … }` with no `catch`, and both
// call sites pass the resulting promise straight into `onClick={() => review(...)}` —
// so a rejection escaped the `try`, was discarded by the click handler, and reached
// nobody: no `reviewed` override (correct), no spinner (correct), and NO message
// anywhere that the coach's Approve did not happen. The button went from "Saving…"
// back to "Approve" as if nothing were wrong.
//
// The failure is driven through the `onReview` prop itself, because that is the only
// seam this component has.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
type Call = {
  findingId: string
  state: 'approved' | 'flagged'
  settled: boolean
  finish: (value: unknown) => void
  fail: (reason: unknown) => void
}
let reviewCalls: Call[]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  reviewCalls = []
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
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

const load = async () => {
  const mod = await import('@/components/FindingsTimeline')
  return mod.default
}

const FINDING = {
  id: 'f1',
  category: 'release',
  start_ms: 1200,
  severity: 'high',
  confidence_band: 'high',
  observation: 'Elbow flies out before extension',
  review_state: 'needs_review',
} as unknown as Finding

type TimelineComponent = (typeof import('@/components/FindingsTimeline'))['default']

const onReview = (findingId: string, state: 'approved' | 'flagged') =>
  new Promise<void>((resolve, reject) => {
    reviewCalls.push({
      findingId,
      state,
      settled: false,
      finish: (value) => resolve(value as void),
      fail: (reason) => reject(reason),
    })
  })

const timeline = (C: TimelineComponent) => (
  <C findings={[FINDING]} onSeek={() => {}} onReview={onReview} />
)

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
  await settle()
}

const buttonByLabel = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ??
  null

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

const settleCall = async (call: Call, value: unknown) => {
  call.settled = true
  await act(async () => {
    call.finish(value)
  })
  await settle()
}

const failCall = async (call: Call, reason: unknown) => {
  call.settled = true
  await act(async () => {
    call.fail(reason)
  })
  await settle()
}

const alert = () => document.body.querySelector('[role="alert"]')
const alertText = () => alert()?.textContent ?? ''

describe('FindingsTimeline — a review that did not happen must say so', () => {
  test('a successful review applies its override and reports no error', async () => {
    // Positive control: proves the click reaches `onReview` and the happy path renders.
    const FindingsTimeline = await load()
    await render(timeline(FindingsTimeline))

    await click(buttonByLabel('Approve'))
    expect(reviewCalls).toHaveLength(1)
    expect(reviewCalls[0].findingId).toBe('f1')
    expect(reviewCalls[0].state).toBe('approved')
    expect(buttonByLabel('Saving…')).not.toBeNull()

    await settleCall(reviewCalls[0], undefined)

    expect(document.body.textContent).toContain('Approved')
    expect(buttonByLabel('Approve')).toBeNull()
    expect(alert()).toBeNull()
    expect(noise).toEqual([])
  })

  test('a rejected review tells the coach and does not claim the decision', async () => {
    const FindingsTimeline = await load()
    await render(timeline(FindingsTimeline))

    await click(buttonByLabel('Approve'))
    expect(reviewCalls).toHaveLength(1)
    expect(buttonByLabel('Saving…')).not.toBeNull()

    await failCall(reviewCalls[0], new Error('Review rejected by server'))

    expect(alertText()).toBe('Review rejected by server')
    // The override must NOT be applied — nothing was recorded.
    expect(document.body.textContent).not.toContain('Approved')
    // And the button must be usable again, not stuck on "Saving…".
    expect(buttonByLabel('Saving…')).toBeNull()
    expect(buttonByLabel('Approve')).not.toBeNull()
    expect(buttonByLabel('Approve')?.disabled).toBe(false)
    expect(noise).toEqual([])
  })

  test('a retry after a failure clears the error it is replacing', async () => {
    // The error must be cleared by the NEXT attempt, not survive it — otherwise a
    // retry that succeeds still shows "could not be saved" over a decision that was.
    const FindingsTimeline = await load()
    await render(timeline(FindingsTimeline))

    await click(buttonByLabel('Approve'))
    await failCall(reviewCalls[0], new Error('Review rejected by server'))
    expect(alertText()).toBe('Review rejected by server')

    await click(buttonByLabel('Approve'))
    expect(reviewCalls).toHaveLength(2)
    // Cleared as soon as the retry starts…
    expect(alert()).toBeNull()

    await settleCall(reviewCalls[1], undefined)
    expect(document.body.textContent).toContain('Approved')
    expect(alert()).toBeNull()
    expect(noise).toEqual([])
  })
})
