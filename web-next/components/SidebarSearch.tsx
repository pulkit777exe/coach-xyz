'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileTextIcon, SearchIcon, UserIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/9ui/ui/dialog'
import { Input } from '@/components/9ui/ui/input'
import { Spinner } from '@/components/org/Spinner'
import {
  ALL_NON_PLAYER_ROLES,
  ANALYZE_NAV_ROLES,
  AUDIT_NAV_ROLES,
  HISTORY_NAV_ROLES,
  MEMBERS_NAV_ROLES,
  type NavRole,
} from '@/lib/nav'
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
  { label: 'Students', hint: 'Roster', href: '/dashboard/students', roles: ALL_NON_PLAYER_ROLES },
  { label: 'Teams', hint: 'Roster', href: '/dashboard/teams', roles: ALL_NON_PLAYER_ROLES },
  { label: 'Members', hint: 'Roster', href: '/dashboard/members', roles: MEMBERS_NAV_ROLES },
  {
    label: 'Attendance',
    hint: 'Roster',
    href: '/dashboard/attendance',
    roles: ALL_NON_PLAYER_ROLES,
  },
  { label: 'Schedule', hint: 'Planning', href: '/dashboard/schedule', roles: ALL_NON_PLAYER_ROLES },
  { label: 'Reports', hint: 'Planning', href: '/dashboard/reports', roles: ALL_NON_PLAYER_ROLES },
  { label: 'History', hint: 'Analysis', href: '/dashboard/history', roles: HISTORY_NAV_ROLES },
  { label: 'New Analysis', hint: 'Analysis', href: '/', roles: ANALYZE_NAV_ROLES },
  { label: 'Account', hint: 'Account', href: '/account' },
  { label: 'Settings', hint: 'Account', href: '/dashboard/settings' },
  { label: 'Audit Log', hint: 'Security', href: '/dashboard/audit', roles: AUDIT_NAV_ROLES },
]

type Result = { key: string; label: string; hint: string; href: string; icon: 'page' | 'player' }

/**
 * Notion search trigger: 32px inset field, 14px muted placeholder, kbd chip
 * right. Inset fill = the quiet-fill tokens (globals: --fill-quiet / -hover).
 */
const TRIGGER_CLASS =
  'mb-2 flex h-8 w-full items-center gap-2 rounded-[6px] bg-fill-quiet px-2 text-left text-body leading-5 text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-fill-quiet-hover focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]'
const KBD_CHIP_CLASS =
  'shrink-0 rounded-[4px] bg-accent px-1.5 py-0.5 text-label leading-none font-medium text-muted-foreground'
/** Panel: radius 8 + hairline; enter 200ms opacity+scale(.98→1) ease-out, exit 150ms ease-in. */
const PANEL_CLASS =
  'max-w-lg gap-0! rounded-[8px]! border border-border bg-popover p-0! shadow-lg duration-200! ease-[var(--ease-out)]! data-starting-style:scale-[0.98]! data-ending-style:duration-150! data-ending-style:ease-in! data-ending-style:scale-[0.98]!'
/** 28px list rows — same pattern as the sidebar. */
const ROW_CLASS =
  'flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left text-body leading-5 outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]'

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
      <button type="button" onClick={() => setOpenState(true)} className={TRIGGER_CLASS}>
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">Search or ask</span>
        <kbd className={KBD_CHIP_CLASS}>Ctrl+K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpenState}>
        <DialogContent
          className={PANEL_CLASS}
          onKeyDown={onDialogKey}
          aria-label="Quick find"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Quick find</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              placeholder="Search pages and players…"
              inputContainerClassName="min-w-0 flex-1"
              className="h-7! border-0! bg-transparent! px-0! text-body leading-5! shadow-none focus-visible:border-0! focus-visible:ring-0!"
              aria-label="Search pages and players"
            />
            {searching && <Spinner className="shrink-0 text-muted-foreground" />}
            <kbd className={KBD_CHIP_CLASS}>Esc</kbd>
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {results.length === 0 ? (
              <li className="px-2 py-6 text-center text-body leading-5 text-muted-foreground">
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
                      ROW_CLASS,
                      i === active
                        ? 'bg-accent text-foreground'
                        : 'text-foreground/90 hover:bg-accent',
                    )}
                  >
                    {r.icon === 'player' ? (
                      <UserIcon
                        className={cn(
                          'size-4 shrink-0',
                          i === active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      />
                    ) : (
                      <FileTextIcon
                        className={cn(
                          'size-4 shrink-0',
                          i === active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    <span className="shrink-0 text-label text-muted-foreground/60">{r.hint}</span>
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
