// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'

// ── NotificationBell: the branch no static render could reach ─────────────────
//
// `if (inAppEnabled !== true) return null` means this component emits NOTHING in
// every server render and in the render sweep — `inAppEnabled` starts null and is
// only set by an effect awaiting the preference fetch. So the sweep counted it
// covered while observing nothing at all, and `vitest --coverage` would agree.
//
// The behaviours worth pinning are the ones that only exist after that gate:
// the fail-open on a prefs outage, the `9+` cap, the local-vs-snapshot merge that
// stops a late snapshot resurrecting a row the user just read, and the live
// SSE row arriving after a snapshot began.
//
// `lib/notifications` is mocked whole because the component imports five separate
// names from it; a partial stub yields `undefined` at exactly the moment the
// effect runs. See the same trap recorded for the logger stub on the server side.

let container: HTMLDivElement
let root: Root
let noise: unknown[]

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
const settle = async (times = 3) => {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}
const text = () => document.body.textContent ?? ''

/**
 * Open the dropdown. Rows live inside `DropdownMenuContent`, which is only mounted
 * while the menu is open — so an assertion on a notification title against the
 * closed tree would fail for a reason that has nothing to do with notifications,
 * which is what this case did before it was opened properly.
 */
const openMenu = async () => {
  const trigger = container.querySelector<HTMLElement>('[aria-label="Notifications"]')!
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })
  await settle()
}

type Note = {
  id: string
  auth0_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  auth0_id: 'auth0|org',
  type: 'analysis.completed',
  title: `Analysis ${id}`,
  body: null,
  data: {},
  read: false,
  created_at: '2026-10-01T09:00:00.000Z',
  ...over,
})

/** Handles the fake SSE subscription exposes to the test. */
let emit: ((n: Note) => void) | null = null
let onReconnect: (() => void) | null = null
const unsubscribed: number[] = []

const load = async (opts: {
  prefs: () => Promise<{ inApp: boolean }>
  snapshot: () => Promise<{ notifications: Note[]; unread_count: number }>
}) => {
  emit = null
  onReconnect = null
  unsubscribed.length = 0
  const pushed: string[] = []

  vi.doMock('next/navigation', () => ({
    useRouter: () => ({
      push: (href: string) => pushed.push(href),
      replace: () => undefined,
      refresh: () => undefined,
      back: () => undefined,
      forward: () => undefined,
      prefetch: () => undefined,
    }),
  }))
  vi.doMock('@/lib/notifications', () => ({
    fetchNotificationsWithRetry: async () => opts.snapshot(),
    markRead: async (id: string) => {
      pushed.push(`read:${id}`)
    },
    markAllRead: async () => {
      pushed.push('read-all')
    },
    // Real behaviour: a `data.href` wins, otherwise fall back to the analysis route.
    notificationHref: (n: { data: Record<string, unknown> }) => {
      const href = n.data.href
      if (typeof href === 'string' && href.length > 0) return href
      const job = n.data.server_job_id
      if (typeof job === 'string' && job.length > 0) {
        return `/dashboard/analysis/${encodeURIComponent(job)}`
      }
      return null
    },
    subscribeNotifications: (
      handler: (n: Note) => void,
      _signal: AbortSignal,
      onOpen: () => void,
    ) => {
      emit = handler
      onReconnect = onOpen
      return () => unsubscribed.push(Date.now())
    },
  }))
  vi.doMock('@/lib/meApi', () => ({ getNotificationPrefs: async () => opts.prefs() }))
  vi.doMock('lucide-react', () => ({ BellIcon: () => null, CheckCheckIcon: () => null }))

  const mod = await import('@/components/notifications/NotificationBell')
  return { Bell: mod.default, pushed }
}

describe('NotificationBell — the gate no static render passes', () => {
  test('renders nothing while the preference is unknown, then appears', async () => {
    let release: (v: { inApp: boolean }) => void = () => undefined
    const { Bell } = await load({
      prefs: () => new Promise((resolve) => (release = resolve)),
      snapshot: async () => ({ notifications: [], unread_count: 0 }),
    })

    await render(<Bell />)
    // The claim the sweep could not make: `inAppEnabled` is null, so there is no
    // markup at all — not a bell with no badge.
    expect(container.innerHTML).toBe('')

    release({ inApp: true })
    await settle()
    expect(container.querySelector('[aria-label="Notifications"]')).not.toBeNull()
  })

  test('renders nothing at all when in-app notifications are switched off', async () => {
    const { Bell } = await load({
      prefs: async () => ({ inApp: false }),
      snapshot: async () => ({ notifications: [note('n1')], unread_count: 1 }),
    })
    await render(<Bell />)
    await settle()
    // The snapshot must not even be fetched for a bell that will never render —
    // and the whole point is that nothing appears.
    expect(container.innerHTML).toBe('')
    expect(noise).toEqual([])
  })

  test('a preference outage FAILS OPEN — a database blip must not hide the bell', async () => {
    const { Bell } = await load({
      prefs: async () => {
        throw new Error('prefs unavailable')
      },
      snapshot: async () => ({ notifications: [], unread_count: 0 }),
    })
    await render(<Bell />)
    await settle()
    // The inverse of the case above, and the reason the catch is `.catch(() => true)`:
    // the two together are the whole policy — an explicit `false` is honoured, an
    // unreachable preference is not treated as `false`.
    expect(container.querySelector('[aria-label="Notifications"]')).not.toBeNull()
  })

  test('the unread badge counts, and caps at 9+', async () => {
    const many = Array.from({ length: 12 }, (_, i) => note(`n${i}`))
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: async () => ({ notifications: many, unread_count: 12 }),
    })
    await render(<Bell />)
    await settle()
    const trigger = container.querySelector('[aria-label="Notifications"]')!
    expect(trigger.textContent).toContain('9+')
    expect(trigger.textContent).not.toContain('12')
  })

  test('the menu opens at all — a Label outside a Group throws on open', async () => {
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: async () => ({ notifications: [note('n1')], unread_count: 1 }),
    })
    await render(<Bell />)
    await settle()
    await openMenu()
    // REGRESSION GUARD for a live shipping bug. `DropdownMenuLabel` wraps Base UI's
    // `Menu.GroupLabel`, which throws "MenuGroupContext is missing" unless a
    // `Menu.Group` ancestor exists — so clicking the bell used to throw and show no
    // notifications at all. Nothing caught it: the render sweep cannot open a menu,
    // and `OrgPill.tsx` (the only other Label call site) wraps correctly, so the
    // component was the odd one out against its own sibling.
    expect(text()).toContain('Notifications')
    expect(text()).toContain('Analysis n1')
  })

  test('a snapshot arriving after a live row keeps both', async () => {
    // The merge subtlety: the snapshot is requested on mount, and a row delivered
    // over SSE while it is still in flight must survive it. `liveNotificationIdsRef`
    // is the mechanism, and it is invisible to any single-render assertion.
    let resolveSnapshot: (v: { notifications: Note[]; unread_count: number }) => void = () => {}
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: () => new Promise((resolve) => (resolveSnapshot = resolve)),
    })
    await render(<Bell />)
    await settle(1)

    // The live row arrives first; the snapshot is still in flight and still loading.
    await act(async () => {
      emit?.(note('live-1'))
    })
    await settle()

    // Now the snapshot lands, carrying a row of its own and a stale unread count.
    await act(async () => {
      resolveSnapshot({ notifications: [note('snap-1')], unread_count: 9 })
    })
    await settle()
    await openMenu()
    // Both rows survive. The live one is the half that matters: without the merge a
    // slow snapshot silently drops a notification the user was already looking at.
    expect(text()).toContain('snap-1')
    expect(text()).toContain('live-1')
  })

  test('the subscription is torn down on unmount', async () => {
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: async () => ({ notifications: [], unread_count: 0 }),
    })
    await render(<Bell />)
    await settle()
    expect(emit).not.toBeNull()
    act(() => root.unmount())
    // A leaked subscription keeps a live SSE connection and, worse, calls
    // setState on an unmounted component — neither of which a render assertion sees.
    expect(unsubscribed.length).toBe(1)
  })

  test('the snapshot is fetched once, not again on every prefs resolution', async () => {
    let calls = 0
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: async () => {
        calls += 1
        return { notifications: [], unread_count: 0 }
      },
    })
    await render(<Bell />)
    await settle()
    // `notificationsLoadedRef` is what makes this hold across a Strict Mode effect
    // replay; without it a double-invoked effect fetches twice.
    expect(calls).toBe(1)
  })

  test('a reconnect re-fetches the snapshot — the subscription-gap recovery', async () => {
    // The subscription can drop rows that arrived while it was down, so the
    // post-connect callback is authoritative for that gap and re-fetches. Without
    // it a reconnect would leave the bell silently incomplete.
    let calls = 0
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: async () => {
        calls += 1
        return { notifications: [note(`n${calls}`)], unread_count: calls }
      },
    })
    await render(<Bell />)
    await settle()
    expect(calls).toBe(1)

    await act(async () => {
      onReconnect?.()
    })
    await settle()
    expect(calls).toBe(2)
    await openMenu()
    // The refetched row replaced the first rather than accumulating duplicates.
    expect(text()).toContain('n2')
  })

  test('a failing snapshot still leaves a usable bell', async () => {
    const { Bell } = await load({
      prefs: async () => ({ inApp: true }),
      snapshot: async () => {
        throw new Error('notifications unavailable')
      },
    })
    await render(<Bell />)
    await settle()
    expect(container.querySelector('[aria-label="Notifications"]')).not.toBeNull()
  })
})