// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { Student } from '@/lib/org/types'

// ── StudentsClient: two roster reads with no token could both apply ──────────
//
// `refreshStudents` (used after an import) and `toggleArchived` each re-read the
// roster through `orgStudents`, and neither the "Show archived" button nor the
// import dialog disables itself while the other read is in flight. The responses
// carried no identity either, so whichever arrived LAST won — and a double-toggled
// roster ended up holding the `includeArchived: true` rows under a toggle that says
// they are hidden. The rollback inside `toggleArchived`'s catch did not help: it
// only guarded that request's own failure, never a competing success.
//
// `orgStudents` is handed out as a deferred so the ORDER can be dictated: the
// abandoned read must land after the current one for the defect to exist.

let container: HTMLDivElement
let root: Root
let noise: unknown[]
type Call = {
  includeArchived: boolean
  settled: boolean
  finish: (value: unknown) => void
  fail: (reason: unknown) => void
}
let rosterCalls: Call[]

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const onRejection = (e: Event) => noise.push((e as PromiseRejectionEvent).reason ?? e)
const onError = (e: Event) => noise.push(e)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  noise = []
  rosterCalls = []
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

const text = () => document.body.textContent ?? ''

const load = async () => {
  vi.doMock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
    Toaster: () => null,
  }))
  vi.doMock('@/lib/org/students', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    orgStudents: (_auth0Id: string, opts: { includeArchived?: boolean }) =>
      new Promise((resolve, reject) => {
        rosterCalls.push({
          includeArchived: opts?.includeArchived === true,
          settled: false,
          finish: (value) => resolve(value),
          fail: (reason) => reject(reason),
        })
      }),
    orgImportStudents: async () => ({
      imported: 1,
      duplicates_skipped: 0,
      failed: [] as { row_index: number; reason: string }[],
    }),
  }))
  const mod = await import('@/components/org/StudentsClient')
  return mod.default
}

const student = (id: string, full_name: string, status: string) =>
  ({ id, full_name, status, email: null, sport: 'Football', team_id: null }) as unknown as Student

const ACTIVE = student('s1', 'Active Alice', 'active')
const ARCHIVED = student('s2', 'Archived Bob', 'archived')

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

const click = async (el: HTMLElement | null) => {
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

/** React tracks the node's own value, so the native setter must be used. */
const setNative = async (selector: string, value: string) => {
  const el = document.body.querySelector(selector)
  expect(el).not.toBeNull()
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, value)
  await act(async () => {
    el!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

describe('StudentsClient — only the newest roster read may answer', () => {
  test('a double toggle does not end up showing the rows the toggle hides', async () => {
    const StudentsClient = await load()
    await render(
      <StudentsClient auth0Id="auth0|org"
      initialStudents={[ACTIVE]}
      sports={['Football']}
      teams={[{ id: 't1', name: 'A Squad' }]}
      canManage
      canInvite
    />,
    )
    expect(text()).toContain('Active Alice')

    // Show archived → read #1 (includeArchived) in flight.
    await click(buttonByLabel('Show archived'))
    expect(rosterCalls).toHaveLength(1)
    expect(rosterCalls[0].includeArchived).toBe(true)

    // Hide archived again → read #2 (includeArchived false) in flight. Neither
    // request knows about the other.
    await click(buttonByLabel('Hide archived'))
    expect(rosterCalls).toHaveLength(2)
    expect(rosterCalls[1].includeArchived).toBe(false)

    // The CURRENT read answers first…
    await finishCall(rosterCalls[1], { students: [ACTIVE] })
    expect(text()).toContain('Active Alice')

    // …and the abandoned one lands afterwards.
    await finishCall(rosterCalls[0], { students: [ACTIVE, ARCHIVED] })

    expect(text()).toContain('Active Alice')
    expect(text()).not.toContain('Archived Bob')
    expect(noise).toEqual([])
  })

  test('a single, un-raced toggle DOES apply its response', async () => {
    // Positive control. Without this, a guard that dropped every response would
    // also pass the case above — the roster would simply never change.
    const StudentsClient = await load()
    await render(
      <StudentsClient auth0Id="auth0|org"
      initialStudents={[ACTIVE]}
      sports={['Football']}
      teams={[{ id: 't1', name: 'A Squad' }]}
      canManage
      canInvite
    />,
    )

    await click(buttonByLabel('Show archived'))
    expect(rosterCalls).toHaveLength(1)
    await finishCall(rosterCalls[0], { students: [ACTIVE, ARCHIVED] })

    expect(text()).toContain('Archived Bob')
    expect(text()).not.toContain('No students yet')
    expect(noise).toEqual([])
  })

  test('a superseded toggle failure does not roll back the newer read', async () => {
    // The other half of the guard: `toggleArchived`'s catch rolls `showArchived`
    // back, and doing so for a request a LATER one superseded would undo the newer
    // state on the strength of an older error. This is the case that would catch a
    // fix which guarded the success path and forgot the failure path.
    //
    // Three toggles, not two: the rollback target is the value `showArchived` had
    // when THAT toggle started, so with two toggles the target and the current value
    // are the same and the unguarded rollback is a no-op — a test built on two would
    // pass against the missing guard for a reason that has nothing to do with it.
    const StudentsClient = await load()
    await render(
      <StudentsClient
        auth0Id="auth0|org"
        initialStudents={[ACTIVE]}
        sports={['Football']}
        teams={[{ id: 't1', name: 'A Squad' }]}
        canManage
        canInvite
      />,
    )

    await click(buttonByLabel('Show archived')) // read #0, showArchived → true
    await click(buttonByLabel('Hide archived')) // read #1, showArchived → false
    await click(buttonByLabel('Show archived')) // read #2, showArchived → true
    expect(rosterCalls).toHaveLength(3)

    await finishCall(rosterCalls[2], { students: [ACTIVE, ARCHIVED] })
    // The OLDEST read fails after the newest one settled.
    rosterCalls[0].settled = true
    await act(async () => {
      rosterCalls[0].fail(new Error('boom'))
    })
    await settle()

    // Toggle still says "archived is shown" — the older failure must not put it back.
    expect(buttonByLabel('Hide archived')).not.toBeNull()
    expect(buttonByLabel('Show archived')).toBeNull()
    expect(text()).toContain('Archived Bob')
    expect(noise).toEqual([])
  })

  test('a roster refresh started by an import does not answer over a newer toggle', async () => {
    // The other reader. `refreshStudents` only runs from the import dialog, so the
    // dialog is driven here rather than the function being asserted in isolation —
    // a guard nobody can reach is not a guard.
    const StudentsClient = await load()
    await render(
      <StudentsClient
        auth0Id="auth0|org"
        initialStudents={[ACTIVE]}
        sports={['Football']}
        teams={[{ id: 't1', name: 'A Squad' }]}
        canManage
        canInvite
      />,
    )

    const exactButton = (label: string) =>
      [...document.body.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === label,
      ) ?? null

    await click(exactButton('Import'))
    await setNative('#import-paste', 'Full name,Status\nActive Alice,active')
    await click(buttonByLabel('student(s)'))
    // The import resolved, so `refreshStudents` is now the in-flight roster read.
    expect(rosterCalls).toHaveLength(1)
    expect(rosterCalls[0].includeArchived).toBe(false)

    // The newer read: "Show archived".
    await click(buttonByLabel('Show archived'))
    expect(rosterCalls).toHaveLength(2)
    expect(rosterCalls[1].includeArchived).toBe(true)

    await finishCall(rosterCalls[1], { students: [ACTIVE, ARCHIVED] })
    await finishCall(rosterCalls[0], { students: [ACTIVE] })

    // The newer answer survives; the import's refresh does not repaint over it.
    expect(text()).toContain('Archived Bob')
    expect(text()).toContain('Active Alice')
    expect(noise).toEqual([])
  })
})
