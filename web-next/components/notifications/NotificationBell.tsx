'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellIcon, CheckCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/9ui/ui/dropdown-menu'
import { Button } from '@/components/9ui/ui/button'
import {
  fetchNotificationsWithRetry,
  markRead,
  markAllRead,
  notificationHref,
  subscribeNotifications,
} from '@/lib/notifications'
import type { AppNotification, NotificationsState } from '@/lib/notifications'
import { getNotificationPrefs } from '@/lib/meApi'
import { formatTimeShort } from '@/lib/date'
import { errorMessageOf } from '@/lib/errors'
import { cn } from '@/lib/utils'

/**
 * Notion popover pattern: hairline panel, radius 6, no entrance animation,
 * exit fade 120ms only. `!` keeps our overrides deterministic against the
 * primitive's defaults (cn does not strip conflicting classes).
 */
const MENU_CLASS =
  'w-80 rounded-[6px] border border-border bg-popover p-1 shadow-md duration-[var(--dur-fast)]! ease-in! data-starting-style:scale-100! data-starting-style:opacity-100! data-ending-style:scale-100!'
const ITEM_CLASS =
  'rounded-[4px] px-2 py-1.5 hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40'
const TRIGGER_CLASS =
  'relative inline-flex size-8 items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]'
/** 6px unread dot on Notion blue (add the bg class conditionally — cn does not strip conflicts). */
const DOT_BASE = 'mt-1.5 size-1.5 shrink-0 rounded-full'

export default function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  // The snapshot read has its own failure flag. It used to catch and drop the error,
  // leaving `notifications` at `[]` — which rendered the confident sentence "No
  // notifications yet" and an unread badge of 0. A coach reading that concludes no
  // report finished, no analysis completed, no membership changed. `inAppEnabled`
  // still fails OPEN below (a prefs outage must not hide the bell); that decision is
  // about whether the bell exists, not about what an empty bell asserts.
  const [loadFailed, setLoadFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [inAppEnabled, setInAppEnabled] = useState<boolean | null>(null)
  const prefsRequestRef = useRef<Promise<boolean> | null>(null)
  const notificationsLoadedRef = useRef(false)
  const liveNotificationIdsRef = useRef<Set<string>>(new Set())
  const locallyReadIdsRef = useRef<Set<string>>(new Set())
  const localRevisionRef = useRef(0)

  useEffect(() => {
    let active = true

    // Reuse the in-flight request across a Strict Mode effect replay, while
    // ensuring preferences are fetched only once for this bell instance.
    const request =
      prefsRequestRef.current ??
      getNotificationPrefs()
        .then((prefs) => prefs.inApp)
        .catch(() => true) // Fail open: a prefs outage must not hide the bell.
    prefsRequestRef.current = request

    void request.then((enabled) => {
      if (active) setInAppEnabled(enabled)
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (inAppEnabled !== true || notificationsLoadedRef.current) return
    notificationsLoadedRef.current = true

    let unsubscribe: (() => void) | null = null
    const controller = new AbortController()

    const mergeSnapshot = (state: NotificationsState, revisionAtStart: number) => {
      const hasLocalChanges = localRevisionRef.current !== revisionAtStart
      setNotifications((prev) => {
        const byId = new Map(state.notifications.map((item) => [item.id, item]))
        for (const item of prev) {
          // Keep a row that arrived by SSE after this snapshot began.
          if (liveNotificationIdsRef.current.has(item.id)) byId.set(item.id, item)
        }
        return [...byId.values()]
      })
      // A snapshot that predates a local event/read must not erase it. The
      // post-connect callback below is authoritative for the subscription gap.
      setUnreadCount((prev) =>
        hasLocalChanges ? Math.max(prev, state.unread_count) : state.unread_count,
      )
    }
    const fetchSnapshot = () => {
      const revisionAtStart = localRevisionRef.current
      return fetchNotificationsWithRetry(controller.signal)
        .then((state) => {
          mergeSnapshot(state, revisionAtStart)
          setLoadFailed(false)
        })
        .catch((err: unknown) => {
          // Carried, not swallowed: the bell stays usable, but an empty list now
          // reads as "this could not be read" rather than "you have none". An abort is
          // the unmount/teardown path, not a failed read, so it sets nothing.
          if (!controller.signal.aborted) setLoadFailed(true)
          throw err
        })
    }

    unsubscribe = subscribeNotifications(
      (n) => {
        const wasLocallyRead = locallyReadIdsRef.current.has(n.id)
        liveNotificationIdsRef.current.add(n.id)
        if (n.read) locallyReadIdsRef.current.add(n.id)
        localRevisionRef.current += 1
        setNotifications((prev) => {
          if (prev.some((existing) => existing.id === n.id)) return prev
          return [n, ...prev]
        })
        setUnreadCount((prev) => (n.read || wasLocallyRead ? prev : prev + 1))
      },
      controller.signal,
      () => {
        void fetchSnapshot().catch(() => {})
      },
    )

    void fetchSnapshot()
      .catch(() => {
        // Non-fatal — empty bell still works
      })
      .finally(() => setIsLoading(false))

    return () => {
      unsubscribe?.()
      controller.abort()
    }
  }, [inAppEnabled])

  const sorted = useMemo(() => {
    return [...notifications].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [notifications])

  const handleOpen = (n: AppNotification) => {
    const href = notificationHref(n)
    if (href) {
      router.push(href)
    }
    if (!n.read) {
      // Keep the locally-read row authoritative over a late snapshot.
      liveNotificationIdsRef.current.add(n.id)
      locallyReadIdsRef.current.add(n.id)
      localRevisionRef.current += 1
      setUnreadCount((prev) => Math.max(0, prev - 1))
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, read: true } : item)),
      )
      markRead(n.id).catch((err: unknown) => {
        // The write did not happen, so the local one must not stand either. Without
        // this the row stays marked read — authoritative over any later snapshot,
        // because `locallyReadIdsRef` still holds the id — and the badge stays down:
        // a claim about the coach's account that is false until reload, with nothing
        // on screen saying so. `markRead` throws on a non-OK response precisely so
        // this can be seen; swallowing it here was the half that made it invisible.
        locallyReadIdsRef.current.delete(n.id)
        setNotifications((prev) =>
          prev.map((item) => (item.id === n.id ? { ...item, read: false } : item)),
        )
        // The inverse of THIS request's optimistic decrement, kept relative so a count
        // change that arrived while it was in flight is preserved.
        setUnreadCount((prev) => prev + 1)
        toast.error(errorMessageOf(err, 'Could not mark that notification as read.'))
      })
    }
    setOpen(false)
  }

  const handleMarkAllRead = () => {
    // Captured BEFORE the optimistic flip: these are the rows the server is being
    // asked to change, and only they may be put back if it refuses.
    const unreadBefore = notifications.filter((n) => !n.read).map((n) => n.id)
    for (const notification of notifications) {
      liveNotificationIdsRef.current.add(notification.id)
      locallyReadIdsRef.current.add(notification.id)
    }
    localRevisionRef.current += 1
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    markAllRead().catch((err: unknown) => {
      const failed = new Set(unreadBefore)
      for (const id of unreadBefore) locallyReadIdsRef.current.delete(id)
      setNotifications((prev) =>
        prev.map((n) => (failed.has(n.id) ? { ...n, read: false } : n)),
      )
      setUnreadCount((prev) => prev + unreadBefore.length)
      toast.error(errorMessageOf(err, 'Could not mark notifications as read.'))
    })
    setOpen(false)
  }

  if (inAppEnabled !== true) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger aria-label="Notifications" className={TRIGGER_CLASS}>
        <BellIcon className="size-4" />
        {unreadCount > 0 ? (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-label leading-none font-semibold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU_CLASS}>
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-0! py-0! text-caption leading-4 font-medium text-muted-foreground">
              Notifications
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6! gap-1! rounded-[4px]! px-1.5! text-label!"
              onClick={handleMarkAllRead}
            >
              <CheckCheckIcon className="size-3" />
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="px-2 py-6 text-center text-body leading-5 text-muted-foreground">
            Loading…
          </div>
        ) : loadFailed && sorted.length === 0 ? (
          // "No notifications yet" is a claim about the coach's account — that no
          // report finished, no analysis completed, no membership changed. After a
          // failed read we know nothing of the sort, so the sentence must be about the
          // read. The badge above still shows 0 for the same reason; this is where the
          // user is told why.
          <div className="px-2 py-6 text-center text-body leading-5 text-muted-foreground">
            Notifications failed to load. Open the menu again shortly.
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-2 py-6 text-center text-body leading-5 text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          sorted.slice(0, 20).map((n, i) => (
            <Fragment key={n.id}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem className={ITEM_CLASS} onClick={() => handleOpen(n)}>
                <span
                  className={cn(DOT_BASE, n.read ? 'bg-transparent' : 'bg-primary')}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-body leading-5',
                        n.read ? 'text-foreground/70' : 'font-medium text-foreground',
                      )}
                    >
                      {n.title}
                    </span>
                    <span className="shrink-0 text-label text-muted-foreground/60">
                      {formatTimeShort(n.created_at)}
                    </span>
                  </div>
                  {n.body ? (
                    <span className="truncate text-caption leading-4 text-muted-foreground">
                      {n.body}
                    </span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            </Fragment>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
