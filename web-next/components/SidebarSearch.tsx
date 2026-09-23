'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileTextIcon, SearchIcon, UserIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/9ui/ui/dialog'
import { Input } from '@/components/9ui/ui/input'
import { Spinner } from '@/components/org/Spinner'
import { AUDIT_NAV_ROLES, MEMBERS_NAV_ROLES, type NavRole } from '@/lib/nav'
import { orgStudents } from '@/lib/org'
import { cn } from '@/lib/utils'

type PageEntry = {
  label: string
  hint: string
  href: string
  roles?: readonly NavRole[]
}

const PAGES: PageEntry[] = [
  { label: 'Home', hint: 'Dashboard', href: '/dashboard' },
  { label: 'Students', hint: 'Roster', href: '/dashboard/students' },
  { label: 'Teams', hint: 'Roster', href: '/dashboard/teams' },
  { label: 'Members', hint: 'Roster', href: '/dashboard/members', roles: MEMBERS_NAV_ROLES },
  { label: 'Attendance', hint: 'Roster', href: '/dashboard/attendance' },
  { label: 'Schedule', hint: 'Planning', href: '/dashboard/schedule' },
  { label: 'Reports', hint: 'Planning', href: '/dashboard/reports' },
  { label: 'History', hint: 'Analysis', href: '/dashboard/history' },
  { label: 'New Analysis', hint: 'Analysis', href: '/' },
  { label: 'Account', hint: 'Account', href: '/account' },
  { label: 'Settings', hint: 'Account', href: '/dashboard/settings' },
  { label: 'Audit Log', hint: 'Security', href: '/dashboard/audit', roles: AUDIT_NAV_ROLES },
]

type Result = { key: string; label: string; hint: string; href: string; icon: 'page' | 'player' }

export default function SidebarSearch({
  auth0Id,
  role = null,
}: {
  auth0Id: string
  role?: NavRole | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Reset query state whenever the palette opens (event handler, so the
  // set-state-in-effect rule stays satisfied).
  const setOpenState = (next: boolean) => {
    if (next) {
      setQuery('')
      setPlayers([])
      setActive(0)
    }
    setOpen(next)
  }
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<{ id: string; full_name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  // Global ⌘K / Ctrl+K toggle (reset lives in setOpenState, an event).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpenState(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Debounced player search — all state writes happen inside the timeout
  // callback (subscription-style), never synchronously in the effect body.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const q = query.trim()
      if (!open || q.length < 2) {
        setPlayers([])
        setSearching(false)
        return
      }
      const my = ++seq.current
      setSearching(true)
      void orgStudents(auth0Id, { search: q })
        .then((res) => {
          if (seq.current !== my) return
          setPlayers(res.students.slice(0, 6).map((s) => ({ id: s.id, full_name: s.full_name })))
        })
        .catch(() => {
          if (seq.current === my) setPlayers([])
        })
        .finally(() => {
          if (seq.current === my) setSearching(false)
        })
    }, 200)
    return () => window.clearTimeout(id)
  }, [query, open, auth0Id])

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase()
    const pages = PAGES.filter(
      (p) =>
        (!p.roles || !role || p.roles.includes(role)) &&
        (!q || p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q)),
    ).map<Result>((p) => ({
      key: p.href,
      label: p.label,
      hint: p.hint,
      href: p.href,
      icon: 'page',
    }))
    const matched = players.map<Result>((s) => ({
      key: `player-${s.id}`,
      label: s.full_name,
      hint: 'Player',
      href: `/dashboard/students/${s.id}`,
      icon: 'player',
    }))
    return [...pages, ...matched].slice(0, 12)
  }, [query, players, role])

  const go = useCallback(
    (href: string) => {
      setOpenState(false)
      router.push(href)
    },
    [router],
  )

  const onDialogKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (results.length ? (a + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[active]
      if (hit) go(hit.href)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenState(true)}
        className="mb-3 flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border bg-muted px-1 text-[10px] font-medium leading-4">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpenState}>
        <DialogContent
          className="max-w-lg gap-0 p-0"
          onKeyDown={onDialogKey}
          aria-label="Quick find"
        >
          <DialogTitle className="sr-only">Quick find</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              placeholder="Search pages and players…"
              className="h-11 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
              aria-label="Search pages and players"
            />
            {searching && <Spinner className="shrink-0 text-muted-foreground" />}
          </div>
          <ul className="max-h-72 overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <li className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">
                {query.trim() ? 'No matches.' : 'Type to search pages and players.'}
              </li>
            ) : (
              results.map((r, i) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                      i === active ? 'bg-accent text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {r.icon === 'player' ? (
                      <UserIcon className="size-4 shrink-0" />
                    ) : (
                      <FileTextIcon className="size-4 shrink-0" />
                    )}
                    <span className="flex-1 truncate font-medium">{r.label}</span>
                    <span className="shrink-0 text-[11px]">{r.hint}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
