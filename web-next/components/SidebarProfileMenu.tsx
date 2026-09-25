'use client'

import Link from 'next/link'
import { Building2, ChevronUp, CircleHelp, LifeBuoy, LogOut, Settings, Sparkles } from 'lucide-react'

import UserAvatar from '@/components/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/9ui/ui/dropdown-menu'

type MenuVariant = 'dashboard' | 'player'

type ProfileMenuItem = {
  href: string
  label: string
  icon: React.ElementType
}

/**
 * Sidebar footer account menu — Notion opens the account menu *upward* from
 * the bottom bar (side="top"), items are icon + label on r4 rows, then the
 * muted email row between separators, then Log out.
 *
 * Player-variant decision (option b): Help / Support / Features / Org all
 * live under /dashboard, whose layout redirects role==='player' to /player
 * (app/dashboard/layout.tsx) — linking them from the player shell would
 * bounce players every time. The player shell therefore renders only
 * Settings (→ /player/settings), a separator, the email row, and Log out.
 */
const TRIGGER_CLASS =
  'flex w-full items-center gap-2 rounded-[6px] px-1 py-1 text-left outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
/** Notion popover pattern (shared with OrgPill/SidebarProfileMenu): exit fade only, no entrance. */
const MENU_CLASS =
  'w-64 rounded-[6px] border border-border bg-popover p-1 shadow-md duration-[120ms]! ease-in! data-starting-style:scale-100! data-starting-style:opacity-100! data-ending-style:scale-100!'
const ITEM_CLASS =
  'rounded-[4px] px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50'

function menuItemsFor(
  variant: MenuVariant,
  settingsHref: ProfileMenuItem['href'],
): ProfileMenuItem[] {
  const settings: ProfileMenuItem = { href: settingsHref, label: 'Settings', icon: Settings }
  if (variant === 'player') return [settings]
  return [
    settings,
    { href: '/dashboard/help', label: 'Help', icon: CircleHelp },
    { href: '/dashboard/support', label: 'Support', icon: LifeBuoy },
    { href: '/dashboard/features', label: 'Features', icon: Sparkles },
    { href: '/dashboard/org', label: 'About your org', icon: Building2 },
  ]
}

export default function SidebarProfileMenu({
  name,
  email,
  picture,
  settingsHref,
  variant,
}: {
  name?: string | null
  email?: string | null
  picture?: string | null
  settingsHref: string
  variant: MenuVariant
}) {
  const items = menuItemsFor(variant, settingsHref)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Account menu" className={TRIGGER_CLASS}>
        <UserAvatar picture={picture} name={name} email={email} size="sm" />
        <span
          className="min-w-0 flex-1 truncate text-sm text-foreground/90"
          title={email ?? undefined}
        >
          {name || email || 'Account'}
        </span>
        <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className={MENU_CLASS}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.href}
            className={ITEM_CLASS}
            render={<Link href={item.href} />}
          >
            <item.icon aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Signed-in email — informational, not a menu action. */}
        <div className="px-2 py-1.5">
          <span
            className="block truncate text-meta text-muted-foreground"
            title={email ?? undefined}
          >
            {email}
          </span>
        </div>
        <DropdownMenuSeparator />
        {/* Full page navigation — /auth/logout leaves the app (no client routing). */}
        <DropdownMenuItem className={ITEM_CLASS} render={<a href="/auth/logout" />}>
          <LogOut aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
