"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BellIcon, CheckCheckIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/9ui/ui/dropdown-menu"
import { Button } from "@/components/9ui/ui/button"
import { Badge } from "@/components/9ui/ui/badge"
import { fetchNotifications, markRead, markAllRead, subscribeNotifications } from "@/lib/notifications"
import type { AppNotification } from "@/lib/notifications"

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

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
    const serverJobId = typeof n.data?.server_job_id === "string" ? n.data.server_job_id : null
    if (serverJobId) {
      router.push(`/dashboard/analysis/${serverJobId}`)
    }
    if (!n.read) {
      setUnreadCount((prev) => Math.max(0, prev - 1))
      setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, read: true } : item)))
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
      <DropdownMenuTrigger aria-label="Notifications" className="relative inline-flex size-8 items-center justify-center rounded-md hover:bg-muted hover:text-foreground">
        <BellIcon className="size-4" />
        {unreadCount > 0 ? (
          <Badge className="absolute -right-1 -top-1 flex size-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none text-white ring-2 ring-[var(--topbar)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1">
          <DropdownMenuLabel className="px-0 text-sm font-semibold">Notifications</DropdownMenuLabel>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleMarkAllRead}>
              <CheckCheckIcon className="size-3" />
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications yet</div>
        ) : (
          sorted.slice(0, 20).map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex items-start gap-2"
              onClick={() => handleOpen(n)}
            >
              <div className="flex w-full flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={n.read ? "text-muted-foreground" : "font-semibold text-foreground"}>{n.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(n.created_at)}</span>
                </div>
                {n.body ? <span className="truncate text-xs text-muted-foreground">{n.body}</span> : null}
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}