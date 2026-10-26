// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { Student } from '@/lib/org/types'

// ── AttendanceGrid: two month reads in flight, no token ──────────────────────
//
// `nav` calls `setMonth(next)` before `fetchMonth(next)`, and neither pager button
// disables itself while a read is in flight, so "Previous month" twice leaves two
// `orgAttendance` reads open over DIFFERENT months. Before `monthSeq` the responses
// carried no identity, so whichever landed LAST won: the abandoned month's rows
// replaced the current month's, and `recordsMonth` was set to a month the heading
// no longer named — which is the combination the stale banner exists to report, but
// only after the screen had already shown another month's marks as this one's.
//
// `orgAttendance` is handed out as a deferred so the ORDER can be dictated: for the
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
let attendanceCalls: Call[]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  attendanceCalls = []
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
  vi.doMock('@/lib/org/attendance', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    orgAttendance: (_auth0Id: string, opts: { from?: string; to?: string }) =>
      new Promise((resolve, reject) => {
        attendanceCalls.push({
          from: opts?.from ?? '',
          to: opts?.to ?? '',
          settled: false,
          finish: (value) => resolve(value),
          fail: (reason) => reject(reason),
        })
      }),
  }))
  const mod = await import('@/components/org/AttendanceGrid')
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

const ALICE = {
  id: 's1',
  auth0_id: 'auth0|s1',
  full_name: 'Active Alice',
  email: null,
  phone: null,
  sport: 'Football',
  position: null,
  jersey_number: null,
  date_of_birth: null,
  gender: null,
  guardian_name: null,
  guardian_phone: null,
  notes: null,
  status: 'active',
  joined_on: null,
  account_auth0_id: null,
  team_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as unknown as Student

const ABSENT_ROW = {
  student_id: 's1',
  session_date: CURRENT_TARGET_DAY,
  status: 'absent',
}

const render = async (ui: ReactElement) => {
  await act(async () => {
    root.render(ui)
  })
  await settle()
}

type GridComponent = (typeof import('@/components/org/AttendanceGrid'))['default']

const grid = (C: GridComponent) => (
  <C auth0Id="auth0|org" students={[ALICE]} initialRecords={[]} canWrite />
)

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

const cellTitle = (title: string) =>
  document.body.querySelector(`button[title="${title}"]`) !== null

const staleBanner = () =>
  [...document.body.querySelectorAll('[role="status"]')].find((el) =>
    (el.textContent ?? '').includes('so the marks below are from a different month') ||
    (el.textContent ?? '').startsWith('Loading '),
  ) ?? null

const spinner = () => document.body.querySelector('[aria-label="Loading"]')

describe('AttendanceGrid — only the newest month read may answer', () => {
  test('an abandoned month read does not repaint over the month on screen', async () => {
    const AttendanceGrid = await load()
    await render(grid(AttendanceGrid))
    // Positive control for the render itself: empty cells before any read lands.
    expect(cellTitle('Click to mark present')).toBe(true)

    await clickByLabel('Previous month')
    await clickByLabel('Previous month')
    expect(attendanceCalls).toHaveLength(2)
    // The two reads really are over DIFFERENT months — otherwise this is one read twice.
    expect(attendanceCalls[0].from).toBe(iso(PREV))
    expect(attendanceCalls[1].from).toBe(iso(PREV_PREV))
    expect(attendanceCalls[1].to < attendanceCalls[0].to).toBe(true)

    // The CURRENT read answers first…
    await finishCall(attendanceCalls[1], { records: [ABSENT_ROW] })
    expect(cellTitle('Absent — click to change')).toBe(true)
    expect(staleBanner()).toBeNull()

    // …and the abandoned month lands afterwards.
    await finishCall(attendanceCalls[0], { records: [] })

    expect(cellTitle('Absent — click to change')).toBe(true)
    expect(staleBanner()).toBeNull()
    // Also pins the month label's `<div>` (not `<p>`) wrapper: `Spinner`'s `Slide`
    // renders a `<div>`, and the first render to put one under that `<p>` logs React's
    // invalid-nesting warning into this array.
    expect(noise).toEqual([])
  })

  test('a single, un-raced month read DOES apply its response', async () => {
    // Positive control. Without it, a guard that dropped every response would also
    // pass the case above — the grid would simply never change.
    const AttendanceGrid = await load()
    await render(grid(AttendanceGrid))

    await clickByLabel('Previous month')
    expect(attendanceCalls).toHaveLength(1)
    await finishCall(attendanceCalls[0], {
      records: [{ student_id: 's1', session_date: iso(PREV), status: 'absent' }],
    })

    expect(cellTitle('Absent — click to change')).toBe(true)
    expect(staleBanner()).toBeNull()
    expect(noise).toEqual([])
  })

  test('a superseded read does not clear the spinner of the read still in flight', async () => {
    // The other half of the fix: `fetchMonth`'s `finally` clears `loading`, and doing
    // so for a request a LATER one superseded drops the spinner (and re-enables the
    // export button) a beat early, while the read that is actually being displayed
    // has not answered yet. This is the case that would catch a fix which guarded the
    // state writes and left the `finally` unguarded.
    const AttendanceGrid = await load()
    await render(grid(AttendanceGrid))

    await clickByLabel('Previous month')
    await clickByLabel('Previous month')
    expect(attendanceCalls).toHaveLength(2)
    expect(spinner()).not.toBeNull()

    // The ABANDONED read settles first, while the current one is still in flight.
    await finishCall(attendanceCalls[0], { records: [] })
    expect(spinner()).not.toBeNull()

    // The current read then answers and the spinner goes.
    await finishCall(attendanceCalls[1], { records: [ABSENT_ROW] })
    expect(spinner()).toBeNull()
    expect(cellTitle('Absent — click to change')).toBe(true)
    expect(noise).toEqual([])
  })
})
