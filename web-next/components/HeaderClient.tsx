'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, ChevronDown } from 'lucide-react'
import UserAvatar from './UserAvatar'
import ThemeToggle from './ThemeToggle'
import GlobalSearch from './GlobalSearch'
import NotificationBell from './notifications/NotificationBell'
import OrgPill from '@/components/org/OrgPill'
import { Button } from '@/components/9ui/ui/button'
import { usePreferenceSync } from '@/lib/preferences'
import type { MyOrg } from '@/lib/meApi'

type HeaderUser = {
  picture?: string | null
  name?: string | null
  email?: string | null
  sub?: string | null
} | null

const MARKETING_ROUTES = [
  '/',
  '/pricing',
  '/features',
  '/about',
  '/contact',
  '/login',
  '/signup',
  '/privacy',
  '/terms',
  '/blog',
]
const isMarketing = (p: string) => MARKETING_ROUTES.some((r) => p === r || p.startsWith(r + '/'))

/* Notion-style nav model: two dropdown groups + direct links. Every original
   route stays reachable (Features, Pricing, Blog, About, Contact, /#analyze). */
const NAV_GROUPS = [
  {
    label: 'Product',
    items: [
      { href: '/features', label: 'Features' },
      { href: '/#analyze', label: 'Analyze a video' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { href: '/blog', label: 'Blog' },
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
] as const

const NAV_DIRECT = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Request a demo' },
] as const

/* Notion palette via semantic tokens — ink, hover fill and CTA colors all
   resolve through globals.css (docs/DESIGN_FOUNDATIONS.md, Tokens). */
const NAV_TEXT = 'text-foreground hover:text-foreground-strong'
const NAV_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const BLUE_CTA =
  'bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring/40'

function NavGroup({
  label,
  items,
  isOpen,
  onToggle,
  onClose,
}: {
  label: string
  items: readonly { href: string; label: string }[]
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className={`inline-flex h-9 items-center gap-1 rounded-[6px] px-2.5 text-sm font-medium transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
      >
        {label}
        <ChevronDown
          aria-hidden
          className={`size-3.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="absolute top-full left-1/2 z-50 w-56 -translate-x-1/2 pt-2">
          <div
            onClick={(e) => e.stopPropagation()}
            // `dark:shadow-none`, not a deeper shadow. globals.css is explicit that
            // dark surfaces "live on low-opacity white borders (shadows don't read on
            // dark)", and every 9ui primitive follows it — card, dialog and
            // dropdown-menu all pair their light shadow with `dark:shadow-none`. This
            // one site had a hand-written rgba pair that went the other way and
            // DEEPENED the shadow 5.6x in dark mode, inverting the system.
            className="rounded-[8px] border border-border bg-background p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:shadow-none"
          >
            {items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                onClick={onClose}
                className={`block rounded-[6px] px-3 py-2 text-sm transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
              >
                {it.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MarketingNav({ user }: { user: HeaderUser }) {
  const [open, setOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  useEffect(() => {
    if (!openGroup) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null)
    }
    const onClick = () => setOpenGroup(null)
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [openGroup])

  const authActions = user ? (
    <>
      <Link
        href="/dashboard"
        onClick={() => setOpen(false)}
        className={`inline-flex h-9 items-center rounded-[6px] px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
      >
        Dashboard
      </Link>
      <Button
        nativeButton={false}
        render={<Link href="/account" />}
        onClick={() => setOpen(false)}
        className={`h-9 rounded-[6px] px-4 text-sm font-medium ${BLUE_CTA}`}
      >
        Account
      </Button>
    </>
  ) : (
    <>
      <Link
        href="/login"
        onClick={() => setOpen(false)}
        className={`inline-flex h-9 items-center rounded-[6px] px-3 text-sm font-medium transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
      >
        Log in
      </Link>
      <Button
        nativeButton={false}
        render={<Link href="/signup" />}
        onClick={() => setOpen(false)}
        className={`h-9 rounded-[6px] px-4 text-sm font-medium ${BLUE_CTA}`}
      >
        Get started free
      </Button>
    </>
  )

  return (
    <nav className="sticky top-0 z-40 border-b border-topbar-border bg-topbar">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-4 px-5 lg:px-8">
        <Link href="/" className={`flex shrink-0 items-center gap-2 rounded-[6px] ${NAV_FOCUS}`}>
          <span className="grid size-6 place-items-center rounded-[6px] bg-primary text-label font-bold text-primary-foreground">
            C
          </span>
          <span className="text-sm font-semibold text-foreground-strong">CoachXYZ</span>
        </Link>

        {/* Center links — 14px/500 */}
        <div className="hidden items-center gap-1 lg:flex">
          {NAV_GROUPS.map((g) => (
            <NavGroup
              key={g.label}
              label={g.label}
              items={g.items}
              isOpen={openGroup === g.label}
              onToggle={() => setOpenGroup((cur) => (cur === g.label ? null : g.label))}
              onClose={() => setOpenGroup(null)}
            />
          ))}
          {NAV_DIRECT.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`inline-flex h-9 items-center rounded-[6px] px-2.5 text-sm font-medium transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 lg:flex">{authActions}</div>

        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => {
            setOpenGroup(null)
            setOpen((v) => !v)
          }}
          className={`inline-flex size-8 items-center justify-center rounded-[6px] text-foreground transition-colors duration-150 hover:bg-muted lg:hidden ${NAV_FOCUS}`}
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-topbar-border bg-topbar lg:hidden">
          <div className="mx-auto flex max-w-[1200px] flex-col px-5 py-3">
            {NAV_GROUPS.map((g) => (
              <div key={g.label} className="py-1">
                <p className="px-2 pb-1 text-label font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {g.label}
                </p>
                {g.items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-[6px] px-2 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            ))}
            <div className="mt-1 border-t border-topbar-border pt-1">
              {NAV_DIRECT.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded-[6px] px-2 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-muted ${NAV_TEXT} ${NAV_FOCUS}`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-topbar-border pt-3">
              {authActions}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

export default function HeaderClient({
  user,
  orgs = [],
  currentOrgId = null,
  role = null,
}: {
  user: HeaderUser
  /** Orgs registered under the user (server-fed; [] when signed out/failed). */
  orgs?: MyOrg[]
  /** Org the current data context is scoped to (org-switcher selection). */
  currentOrgId?: string | null
  /** Account role (users.role); null when unresolved → full topbar. */
  role?: string | null
}) {
  const pathname = usePathname()
  // Players: no workspace to switch (only the owner-of-self phantom) and no
  // dashboard to open (/dashboard redirects them to /player) — the sidebar's
  // My Hub is their nav.
  const isPlayer = role === 'player'

  // Signed-in only: mirror theme/motion/week-start to the account so they
  // follow the user across devices. Marketing visitors never hit the API.
  usePreferenceSync(Boolean(user))

  // Marketing pages get their own theme-aware Notion nav
  if (isMarketing(pathname)) return <MarketingNav user={user} />

  // Dashboard / app — theme-aware (light/dark) with spacer so body doesn't need pt
  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between gap-2 sm:gap-3 lg:gap-4 bg-topbar border-b border-topbar-border px-3 sm:px-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2.5 shrink-0 rounded-[6px] px-1 py-1 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="inline-flex size-7 items-center justify-center rounded-[6px] bg-primary text-primary-foreground text-xs font-bold">
              C
            </span>
            <span className="hidden sm:inline text-sm font-semibold text-foreground">CoachXYZ</span>
          </Link>
          {/* Workspace context — the orgs registered under the user. The app
              brand lives only above; the sidebar stays nav-only. */}
          {!isPlayer && orgs.length > 0 && (
            <span className="hidden sm:inline text-muted-foreground/40" aria-hidden>
              |
            </span>
          )}
          {!isPlayer && <OrgPill orgs={orgs} currentAuth0Id={currentOrgId} />}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <GlobalSearch sub={user?.sub ?? null} />
          <div className="hidden sm:flex items-center text-muted-foreground">
            <ThemeToggle />
          </div>
          {user ? (
            <div className="flex items-center gap-2">
              <NotificationBell />
              {!isPlayer && (
                <Link
                  href="/dashboard"
                  className="hidden sm:inline-flex h-9 items-center rounded-[6px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  Dashboard
                </Link>
              )}
              <Link
                href="/account"
                className="rounded-[6px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <UserAvatar picture={user.picture} name={user.name} email={user.email} size="sm" />
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <a
                href="/auth/login"
                className="hidden sm:inline-flex h-9 items-center rounded-[6px] px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                Log in
              </a>
              <a
                href="/auth/login?screen_hint=signup"
                className="inline-flex h-9 items-center rounded-[6px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                Sign up
              </a>
            </div>
          )}
        </div>
      </header>
      <div className="h-14 shrink-0" aria-hidden />
    </>
  )
}
