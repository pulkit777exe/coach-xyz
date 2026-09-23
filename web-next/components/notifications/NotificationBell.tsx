'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellIcon, CheckCheckIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/9ui/ui/dropdown-menu'
import { Button } from '@/components/9ui/ui/button'
import {
  fetchNotifications,
  markRead,
  markAllRead,
  subscribeNotifications,
} from '@/lib/notifications'
import type { AppNotification } from '@/lib/notifications'
import { cn } from '@/lib/utils'

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * Notion popover pattern: hairline panel, radius 6, no entrance animation,
 * exit fade 120ms only. `!` keeps our overrides deterministic against the
 * primitive's defaults (cn does not strip conflicting classes).
 */
const MENU_CLASS =
  'w-80 rounded-[6px] border border-border bg-popover p-1 shadow-md duration-[120ms]! ease-in! data-starting-style:scale-100! data-starting-style:opacity-100! data-ending-style:scale-100!'
const ITEM_CLASS =
  'rounded-[4px] px-2 py-1.5 hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50'
const TRIGGER_CLASS =
  'relative inline-flex size-8 items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
/** 6px unread dot on Notion blue (add the bg class conditionally — cn does not strip conflicts). */
const DOT_BASE = 'mt-1.5 size-1.5 shrink-0 rounded-full'

export default function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    let unsubscribe: (() => void) | null = null
    const controller = new AbortController()

    fetchNotifications()
      .then((state) => {
        setNotifications(state.notifications)
        setUnreadCount(state.unread_count)
      })
      .catch(() => {
        // Non-fatal — empty bell still works
      })
      .finally(() => setIsLoading(false))

    unsubscribe = subscribeNotifications((n) => {
      setNotifications((prev) => {
        if (prev.some((existing) => existing.id === n.id)) return prev
        return [n, ...prev]
      })
      setUnreadCount((prev) => prev + 1)
    }, controller.signal)

    return () => {
      unsubscribe?.()
      controller.abort()
    }
  }, [])

  const sorted = useMemo(() => {
    return [...notifications].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [notifications])

  const handleOpen = (n: AppNotification) => {
    const serverJobId = typeof n.data?.server_job_id === 'string' ? n.data.server_job_id : null
    if (serverJobId) {
      router.push(`/dashboard/analysis/${serverJobId}`)
    }
    if (!n.read) {
      setUnreadCount((prev) => Math.max(0, prev - 1))
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, read: true } : item)),
      )
      markRead(n.id).catch(() => {})
    }
    setOpen(false)
  }

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
    markAllRead().catch(() => {})
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger aria-label="Notifications" className={TRIGGER_CLASS}>
        <BellIcon className="size-4" />
        {unreadCount > 0 ? (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2383e2] px-1 text-[11px] leading-none font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={MENU_CLASS}>
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <DropdownMenuLabel className="px-0! py-0! text-xs font-medium text-muted-foreground">
            Notifications
          </DropdownMenuLabel>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6! gap-1! rounded-[4px]! px-1.5! text-[11px]!"
              onClick={handleMarkAllRead}
            >
              <CheckCheckIcon className="size-3" />
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          sorted.slice(0, 20).map((n, i) => (
            <Fragment key={n.id}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem className={ITEM_CLASS} onClick={() => handleOpen(n)}>
                <span
                  className={cn(DOT_BASE, n.read ? 'bg-transparent' : 'bg-[#2383e2]')}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm',
                        n.read ? 'text-foreground/70' : 'font-medium text-foreground',
                      )}
                    >
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/60">
                      {formatTime(n.created_at)}
                    </span>
                  </div>
                  {n.body ? (
                    <span className="truncate text-xs text-muted-foreground">{n.body}</span>
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
