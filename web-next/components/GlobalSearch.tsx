'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Users,
  CalendarDays,
  FileText,
  Video,
  House,
  ClipboardCheck,
  History,
  Settings,
} from 'lucide-react'

import { Input } from '@/components/9ui/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/9ui/ui/dialog'
import { Spinner } from '@/components/org/Spinner'
import { orgSearch } from '@/lib/org/overview'
import { type OrgSearchResult } from '@/lib/org/overview'

type Category = {
  key: keyof OrgSearchResult
  label: string
  icon: React.ElementType
  href: (id: string) => string
}

const CATEGORIES: Category[] = [
  { key: 'students', label: 'Students', icon: Users, href: (id) => `/dashboard/students/${id}` },
  { key: 'schedule', label: 'Events', icon: CalendarDays, href: () => '/dashboard/schedule' },
  { key: 'reports', label: 'Reports', icon: FileText, href: (id) => `/dashboard/reports/${id}` },
  { key: 'analyses', label: 'Analyses', icon: Video, href: (id) => `/dashboard/analysis/${id}` },
]

const QUICK_LINKS: { label: string; icon: React.ElementType; href: string }[] = [
  { label: 'Dashboard', icon: House, href: '/dashboard' },
  { label: 'Students', icon: Users, href: '/dashboard/students' },
  { label: 'Attendance', icon: ClipboardCheck, href: '/dashboard/attendance' },
  { label: 'Schedule', icon: CalendarDays, href: '/dashboard/schedule' },
  { label: 'Reports', icon: FileText, href: '/dashboard/reports' },
  { label: 'History', icon: History, href: '/dashboard/history' },
  { label: 'Settings', icon: Settings, href: '/dashboard/settings' },
]

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 px-2.5 pt-3 pb-1 text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  )
}

export default function GlobalSearch({ sub }: { sub: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OrgSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestRef = useRef(0)

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setQuery('')
      setResults(null)
      setError(null)
      setLoading(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      requestRef.current += 1
    }
  }, [])

  const go = useCallback(
    (href: string) => {
      router.push(href)
      handleOpenChange(false)
    },
    [router, handleOpenChange],
  )

  const runSearch = useCallback(
    async (q: string) => {
      if (!sub) return
      const reqId = ++requestRef.current
      setLoading(true)
      setError(null)
      try {
        const res = await orgSearch(sub, q)
        if (reqId === requestRef.current) {
          setResults(res)
          setLoading(false)
        }
      } catch (e) {
        if (reqId === requestRef.current) {
          setError((e as { message?: string } | null)?.message ?? 'Search failed')
          setLoading(false)
        }
      }
    },
    [sub],
  )

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const q = query.trim()
    timerRef.current = setTimeout(() => {
      if (!sub || q.length < 1) {
        requestRef.current += 1
        setResults(null)
        setError(null)
        setLoading(false)
        return
      }
      runSearch(q)
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, sub, runSearch])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (e.key === '/' && !open) {
        const t = e.target as HTMLElement | null
        const tag = t?.tagName
        const editable = t?.isContentEditable
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !editable) {
          e.preventDefault()
          setOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const isEmptyQuery = query.trim().length === 0
  const totalItems = results
    ? results.students.length +
      results.schedule.length +
      results.reports.length +
      results.analyses.length
    : 0

  return (
    <>
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="hidden sm:flex h-8 w-[240px] lg:w-[320px] items-center gap-2 rounded-[6px] border border-border bg-muted pl-2.5 pr-1.5 text-meta text-muted-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="inline-flex items-center rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium tracking-widest text-muted-foreground">
          CTRL + K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          aria-label="Search"
          className="gap-0 p-0 sm:max-w-[540px]"
        >
          {/* Base UI names the popup from DialogTitle only — without this the
              dialog is announced as a bare "dialog". Same pattern as
              SidebarSearch. */}
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="border-b border-border p-3 pb-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                const v = e.target.value
                setQuery(v)
                if (sub && v.trim().length >= 1) {
                  setLoading(true)
                  setError(null)
                } else {
                  setLoading(false)
                }
              }}
              placeholder="Search students, reports, analyses..."
              aria-label="Search students, reports, analyses"
              leadingIcon={<Search className="size-4" />}
              trailingIcon={loading ? <Spinner /> : undefined}
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto pb-2">
            {isEmptyQuery ? (
              <>
                <SectionHeading>Quick links</SectionHeading>
                <div className="px-2">
                  {QUICK_LINKS.map(({ label, icon: Icon, href }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => go(href)}
                      className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-body text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : error ? (
              <p className="px-4 py-8 text-center text-body text-muted-foreground">{error}</p>
            ) : loading && !results ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : totalItems === 0 ? (
              <p className="px-4 py-8 text-center text-body text-muted-foreground">
                No results for &apos;{query.trim()}&apos;
              </p>
            ) : (
              results &&
              CATEGORIES.map(({ key, label, icon: Icon, href }) => {
                const items = results[key]
                if (items.length === 0) return null
                return (
                  <div key={key}>
                    <SectionHeading>{label}</SectionHeading>
                    <div className="px-2">
                      {items.map((item) => (
                        <button
                          key={`${key}-${item.id}`}
                          type="button"
                          onClick={() => go(href(item.id))}
                          className="flex w-full items-start gap-2.5 rounded-[4px] px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block truncate text-body text-foreground">
                              {item.label}
                            </span>
                            {item.subtitle && (
                              <span className="block truncate text-meta text-muted-foreground">
                                {item.subtitle}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
