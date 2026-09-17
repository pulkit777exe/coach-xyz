'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, PanelLeft, CircleHelp } from 'lucide-react'
import UserAvatar from './UserAvatar'
import ThemeToggle from './ThemeToggle'
import GlobalSearch from './GlobalSearch'
import NotificationBell from './notifications/NotificationBell'

type HeaderUser = { picture?: string | null; name?: string | null; email?: string | null; sub?: string | null } | null

const MARKETING_ROUTES = ['/', '/pricing', '/features', '/about', '/contact', '/login', '/signup', '/privacy', '/terms']
const isMarketing = (p: string) => MARKETING_ROUTES.some(r => p === r || p.startsWith(r + '/'))

function MarketingNav({ user }: { user: HeaderUser }) {
  return (
    <nav className="sticky top-0 z-40 border-b border-white/5 bg-[var(--marketing-dark)]/80 backdrop-blur supports-[backdrop-filter]:bg-[var(--marketing-dark)]/70">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-4 px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-[var(--marketing-brown)]">C</span>
          <span className="text-sm font-bold tracking-tight text-[var(--marketing-beige)]">CoachXYZ</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm md:flex">
          <a href="/features" className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)]">Features</a>
          <a href="/pricing" className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)]">Pricing</a>
          <Link href="/blog" className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)]">Blog</Link>
          <a href="/about" className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)]">About</a>
          <a href="/contact" className="text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)]">Contact</a>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link href="/dashboard" className="hidden h-8 items-center rounded-full px-4 text-sm font-medium text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] sm:inline-flex">Dashboard</Link>
              <Link href="/account" className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-sm font-semibold text-[var(--marketing-brown)] hover:bg-primary/90">Account</Link>
            </>
          ) : (
            <>
              <a href="/login" className="hidden h-8 items-center rounded-full px-4 text-sm font-medium text-[var(--marketing-beige)]/70 hover:text-[var(--marketing-beige)] sm:inline-flex">Log in</a>
              <a href="/signup" className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-sm font-semibold text-[var(--marketing-brown)] hover:bg-primary/90">Sign up</a>
            </>
          )}
        </div>
      </div>
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
      <header className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between gap-4 bg-[var(--topbar)] border-b border-[var(--topbar-border)] px-3 sm:px-4">
      <div className="flex items-center gap-3 min-w-0">
        <button aria-label="Toggle sidebar" className="hidden sm:inline-flex size-8 items-center justify-center rounded-md border border-[var(--topbar-border)] bg-[var(--topbar)] text-muted-foreground hover:bg-muted">
          <PanelLeft className="size-4" />
        </button>
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">C</span>
          <span className="hidden sm:inline text-sm font-semibold text-foreground">CoachXYZ</span>
        </Link>
        <span className="hidden sm:inline text-muted-foreground/40">|</span>
        <div className="hidden md:flex items-center gap-2 min-w-0">
          <span className="text-[11px]">🇺🇸</span>
          <span className="text-sm text-muted-foreground truncate max-w-[160px]">dev-0lpn2fkjia...</span>
          <span className="inline-flex items-center rounded-full border border-primary/30 bg-success/15 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-success dark:bg-primary/20 dark:text-primary">DEV</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-muted-foreground"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <GlobalSearch sub={user?.sub ?? null} />
        <div className="hidden sm:flex items-center gap-1 text-muted-foreground">
          <button aria-label="Apps" className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"><LayoutGrid className="size-4" /></button>
          <ThemeToggle />
          <button aria-label="Help" className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"><CircleHelp className="size-4" /></button>
        </div>
        {user ? (
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link href="/dashboard" className="hidden sm:inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Dashboard</Link>
            <Link href="/account"><UserAvatar picture={user.picture} name={user.name} email={user.email} size="sm" /></Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <a href="/auth/login" className="hidden sm:inline-flex h-8 items-center px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Log In</a>
            <a href="/auth/login?screen_hint=signup" className="inline-flex h-8 items-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Sign Up</a>
          </div>
        )}
      </div>
    </header>
      <div className="h-14 shrink-0" aria-hidden />
    </>
  )
}
