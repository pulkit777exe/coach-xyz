// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { ScheduleEvent } from '@/lib/org'

// ── ScheduleClient: two month reads in flight, no token ──────────────────────
//
// Same defect as `AttendanceGrid`, in its twin: `nav` sets the month BEFORE fetching,
// neither pager button disables itself, and the "Today" control fires `fetchMonth` too —
// so two `orgSchedule` reads over DIFFERENT months can be open at once. Before
// `monthSeq` the responses carried no identity, so whichever landed LAST won: the
// abandoned month's rows replaced the displayed month's, `eventsMonth` was set to a
// month the heading no longer named, and the calendar showed an empty month (the
// abandoned rows are dropped by `byDay`, which only places events on the displayed
// month's cells) under a heading with no explanation.
//
// `orgSchedule` is handed out as a deferred so the ORDER can be dictated: for the
// defect to exist, the abandoned read must settle after the current one.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
type Call = {
  from: string
  to: string
  settled: boolean
  finish: (value: unknown) => void
  fail: (reason: unknown) => void
}
let scheduleCalls: Call[]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  scheduleCalls = []
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
  vi.doMock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
    Toaster: () => null,
  }))
  // `usePreferences` throws outside its provider, and the provider pulls `next-themes`.
  // Neither is what this file is about, so only the preference READ is stubbed.
  vi.doMock('@/lib/preferences', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    usePreferences: () => ({
      prefs: { theme: 'system', weekStartsMonday: false, reduceMotion: false },
      setTheme: vi.fn(),
      setWeekStartsMonday: vi.fn(),
      setReduceMotion: vi.fn(),
    }),
  }))
  vi.doMock('@/lib/org', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    orgSchedule: (_auth0Id: string, opts: { from?: string; to?: string }) =>
      new Promise((resolve, reject) => {
        scheduleCalls.push({
          from: opts?.from ?? '',
          to: opts?.to ?? '',
          settled: false,
          finish: (value) => resolve(value),
          fail: (reason) => reject(reason),
        })
      }),
  }))
  const mod = await import('@/components/org/ScheduleClient')
  return mod.default
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The component keys cells on the LOCAL day (`toISODate`). */
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const NOW = new Date()
const PREV = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1)
const PREV_PREV = new Date(NOW.getFullYear(), NOW.getMonth() - 2, 1)
/** A day inside the month two clicks back — the month still displayed at the end. */
const CURRENT_TARGET_DAY = iso(new Date(PREV_PREV.getFullYear(), PREV_PREV.getMonth(), 15))

const SESSION = {
  id: 'ev1',
  event_type: 'practice',
  title: 'Team Session',
  starts_at: `${CURRENT_TARGET_DAY}T18:00:00`,
  ends_at: null,
  location: null,
  description: null,
  status: 'scheduled',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as unknown as ScheduleEvent

/** Same event, but dated for a SINGLE-previous-month navigation. */
const PREV_SESSION = {
  ...SESSION,
  starts_at: `${iso(new Date(PREV.getFullYear(), PREV.getMonth(), 15))}T18:00:00`,
} as unknown as ScheduleEvent

type ScheduleComponent = (typeof import('@/components/org/ScheduleClient'))['default']

const calendar = (C: ScheduleComponent) => <C auth0Id="auth0|org" initialEvents={[]} />

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
  await settle()
}

const clickByLabel = async (label: string) => {
  const el = [...document.body.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label,
  )
  expect(el).not.toBeNull()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

const finishCall = async (call: Call, value: unknown) => {
  call.settled = true
  await act(async () => {
    call.finish(value)
  })
  await settle()
}

const eventTitle = () => document.body.querySelector('[title="Team Session"]') !== null

const staleBanner = () =>
  [...document.body.querySelectorAll('[role="status"]')].find(
    (el) =>
      (el.textContent ?? '').includes('so the events below are from a different month') ||
      (el.textContent ?? '').startsWith('Loading '),
  ) ?? null

const spinner = () => document.body.querySelector('[aria-label="Loading"]')

describe('ScheduleClient — only the newest month read may answer', () => {
  test('an abandoned month read does not repaint over the month on screen', async () => {
    const ScheduleClient = await load()
    await render(calendar(ScheduleClient))
    // Positive control for the render itself: no events before any read lands.
    expect(eventTitle()).toBe(false)

    await clickByLabel('Previous month')
    await clickByLabel('Previous month')
    expect(scheduleCalls).toHaveLength(2)
    // The two reads really are over DIFFERENT months — otherwise this is one read twice.
    expect(scheduleCalls[1].from < scheduleCalls[0].from).toBe(true)
    expect(scheduleCalls[1].to < scheduleCalls[0].to).toBe(true)

    // The CURRENT read answers first…
    await finishCall(scheduleCalls[1], { events: [SESSION] })
    expect(eventTitle()).toBe(true)
    expect(staleBanner()).toBeNull()

    // …and the abandoned month lands afterwards.
    await finishCall(scheduleCalls[0], { events: [] })

    expect(eventTitle()).toBe(true)
    expect(staleBanner()).toBeNull()
    expect(noise).toEqual([])
  })

  test('a single, un-raced month read DOES apply its response', async () => {
    // Positive control. Without it, a guard that dropped every response would also
    // pass the case above — the calendar would simply never change.
    const ScheduleClient = await load()
    await render(calendar(ScheduleClient))

    await clickByLabel('Previous month')
    expect(scheduleCalls).toHaveLength(1)
    await finishCall(scheduleCalls[0], { events: [PREV_SESSION] })

    expect(eventTitle()).toBe(true)
    expect(staleBanner()).toBeNull()
    expect(noise).toEqual([])
  })

  test('a superseded read does not clear the spinner of the read still in flight', async () => {
    // The other half of the fix: `fetchMonth`'s `finally` clears `loading`, and doing so
    // for a request a LATER one superseded drops the spinner (and re-enables the export
    // button) while the read actually being displayed has not answered yet.
    const ScheduleClient = await load()
    await render(calendar(ScheduleClient))

    await clickByLabel('Previous month')
    await clickByLabel('Previous month')
    expect(scheduleCalls).toHaveLength(2)
    expect(spinner()).not.toBeNull()

    // The ABANDONED read settles first, while the current one is still in flight.
    await finishCall(scheduleCalls[0], { events: [] })
    expect(spinner()).not.toBeNull()

    // The current read then answers and the spinner goes.
    await finishCall(scheduleCalls[1], { events: [SESSION] })
    expect(spinner()).toBeNull()
    expect(eventTitle()).toBe(true)
    expect(noise).toEqual([])
  })
})
