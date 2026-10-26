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
import { orgStudents } from '@/lib/org/students'
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
  // Sequence token for the debounced player search. Bumped whenever an in-flight
  // search is abandoned (palette open/close, query reset) so a response that no
  // longer describes what is on screen is dropped rather than applied.
  const seq = useRef(0)

  // Reset query state whenever the palette opens (event handler, so the
  // set-state-in-effect rule stays satisfied).
  const setOpenState = (next: boolean) => {
    // Either direction abandons whatever search is in flight: opening replaces the
    // query with '', closing makes the answer irrelevant. Invalidate here rather than
    // only in the debounce's reset branch, because that branch runs up to 200ms later
    // — in that window the abandoned response can still land and paint player rows
    // under an empty query.
    seq.current += 1
    if (next) {
      setQuery('')
      setPlayers([])
      setPlayersFailed(false)
      setActive(0)
    }
    setOpen(next)
  }
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<{ id: string; full_name: string }[]>([])
  // The player read has its OWN failure flag. Pages are filtered locally from the
  // `PAGES` constant, so a page result is real the moment it renders; a rejected
  // `orgStudents` used to leave `players` at `[]`, which the "No matches." branch
  // then reported as "no such player exists". Partial failure must therefore be
  // reported as partial failure, and must not hide the page results that did load.
  const [playersFailed, setPlayersFailed] = useState(false)
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)

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
        // Bump the sequence here, not only when a NEW attempt begins. This branch
        // abandons whatever was in flight (palette closed, query cleared below the
        // floor), and without the bump the abandoned response still matches the
        // `seq.current` it captured — so it lands afterwards and paints results for
        // a query that is no longer on screen. Same rule as GlobalSearch's reset
        // branch: invalidating the request is part of clearing the state it feeds.
        seq.current += 1
        setPlayers([])
        setPlayersFailed(false)
        setSearching(false)
        return
      }
      const my = ++seq.current
      setSearching(true)
      // Cleared HERE, when a new attempt begins — not only on success. A flag that
      // outlives the request it describes would keep printing the previous failure
      // through the whole retry, which is the same "failed reads look like empty
      // reads" mistake in the other direction: a stale failure read as a live one.
      setPlayersFailed(false)
      void orgStudents(auth0Id, { search: q })
        .then((res) => {
          if (seq.current !== my) return
          setPlayers(res.students.slice(0, 6).map((s) => ({ id: s.id, full_name: s.full_name })))
          setPlayersFailed(false)
        })
        .catch(() => {
          // Clearing the list is still correct — a stale row from a previous query
          // would be a worse lie than none — but the failure is now carried beside
          // it, so the empty state below stops claiming the player does not exist.
          if (seq.current === my) {
            setPlayers([])
            setPlayersFailed(true)
          }
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
  /**
   * A handler per row, built during render. `go` reaches `seq` (a ref) through
   * `setOpenState`, and `react-hooks/refs` refuses a ref-touching CALL made inside
   * `results.map(...)` — the arrow `() => go(r.href)` is created in render scope, so
   * it reads as reading the ref during render. This factory touches only `r.href`
   * here; the ref is read when the returned handler runs, i.e. in the click.
   */
  const goFor = (href: string) => () => go(href)

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
                {/* "No matches." is a claim about the player's existence, and it is
                    only true when the player read SUCCEEDED. On a rejected read the
                    honest sentence is that the search failed. */}
                {playersFailed
                  ? 'Player search failed to load.'
                  : searching
                    ? 'Searching…'
                    : query.trim()
                      ? 'No matches.'
                      : 'Type to search pages and players.'}
              </li>
            ) : (
              results.map((r, i) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={goFor(r.href)}
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
            {/* Partial failure: the page matches above are real (they come from the
                static PAGES list), but the player half of the query is missing. Saying
                nothing here would let the visible page results read as the complete
                answer for the query. `results.length > 0` is load-bearing — with no rows
                at all the branch above already says the search failed, and this would
                print the same sentence twice. */}
            {playersFailed && results.length > 0 ? (
              <li className="px-2 py-3 text-center text-caption leading-4 text-muted-foreground">
                Player search failed to load — page matches only.
              </li>
            ) : null}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
