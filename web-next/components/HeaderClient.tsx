'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import UserAvatar from './UserAvatar'
import ThemeToggle from './ThemeToggle'
import GlobalSearch from './GlobalSearch'
import NotificationBell from './notifications/NotificationBell'

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

const MARKETING_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const

function MarketingNav({ user }: { user: HeaderUser }) {
  const [open, setOpen] = useState(false)
  return (
    <nav className="sticky top-0 z-40 border-b border-[var(--marketing-white)]/5 bg-[var(--marketing-dark)]/80 backdrop-blur supports-[backdrop-filter]:bg-[var(--marketing-dark)]/70">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-4 px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-[var(--marketing-brown)]">
            C
          </span>
          <span className="text-sm font-bold tracking-tight text-[var(--marketing-beige)]">
            CoachXYZ
          </span>
        </Link>
        <div className="hidden items-center gap-6 text-sm md:flex">
          {MARKETING_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)] rounded-sm"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="hidden h-8 items-center rounded-full px-4 text-sm font-medium text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] sm:inline-flex"
              >
                Dashboard
              </Link>
              <Link
                href="/account"
                className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-sm font-semibold text-[var(--marketing-brown)] hover:bg-primary/90"
              >
                Account
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-8 items-center rounded-full px-4 text-sm font-medium text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)]"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-sm font-semibold text-[var(--marketing-brown)] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)]"
              >
                Sign up
              </Link>
            </>
          )}
          <button
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-8 items-center justify-center rounded-md text-[var(--marketing-beige)]/70 hover:bg-[var(--marketing-white)]/5 hover:text-[var(--marketing-beige)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)] md:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-[var(--marketing-white)]/5 bg-[var(--marketing-dark)]/95 md:hidden">
          <div className="mx-auto flex max-w-[1120px] flex-col px-6 py-3">
            {MARKETING_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2.5 text-sm font-medium text-[var(--marketing-beige)]/70 hover:bg-[var(--marketing-white)]/5 hover:text-[var(--marketing-beige)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marketing-purple-light)]"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}

export default function HeaderClient({ user }: { user: HeaderUser }) {
  const pathname = usePathname()

  // Marketing pages get their own dark nav (always dark, no theme toggle)
  if (isMarketing(pathname)) return <MarketingNav user={user} />

  // Dashboard / app — theme-aware (light/dark) with spacer so body doesn't need pt
  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between gap-4 bg-topbar border-b border-topbar-border px-3 sm:px-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
              C
            </span>
            <span className="hidden sm:inline text-sm font-semibold text-foreground">CoachXYZ</span>
          </Link>
          <span className="hidden sm:inline text-muted-foreground/40">|</span>
          <div className="hidden md:flex items-center gap-2 min-w-0">
            <span className="text-[11px]">🇺🇸</span>
            <span className="text-sm text-muted-foreground truncate max-w-[160px]">
              dev-0lpn2fkjia...
            </span>
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-success/15 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-success dark:bg-primary/20 dark:text-primary">
              DEV
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              className="text-muted-foreground"
            >
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <GlobalSearch sub={user?.sub ?? null} />
          <div className="hidden sm:flex items-center gap-1 text-muted-foreground">
            <ThemeToggle />
          </div>
          {user ? (
            <div className="flex items-center gap-2">
              <NotificationBell />
              <Link
                href="/dashboard"
                className="hidden sm:inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Dashboard
              </Link>
              <Link href="/account">
                <UserAvatar picture={user.picture} name={user.name} email={user.email} size="sm" />
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <a
                href="/auth/login"
                className="hidden sm:inline-flex h-8 items-center px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Log In
              </a>
              <a
                href="/auth/login?screen_hint=signup"
                className="inline-flex h-8 items-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Sign Up
              </a>
            </div>
          )}
        </div>
      </header>
      <div className="h-14 shrink-0" aria-hidden />
    </>
  )
}
