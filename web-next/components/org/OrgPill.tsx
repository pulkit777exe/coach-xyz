'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'

import type { MyOrg } from '@/lib/meApi'
import { setOrgCookie } from '@/lib/orgCookie'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/9ui/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const ROLE_DOT: Record<MyOrg['role'], string> = {
  owner: 'bg-success',
  admin: 'bg-info',
  head_coach: 'bg-warning',
  assistant_coach: 'bg-warning/70',
  coach: 'bg-warning',
  analyst: 'bg-info/70',
  medical: 'bg-muted-foreground/60',
  player: 'bg-muted-foreground/60',
}

/** `head_coach` → `head coach` (capitalized by the `capitalize` class). */
const roleLabel = (role: MyOrg['role']) => role.replace(/_/g, ' ')

/**
 * Notion popover pattern: hairline panel, radius 6, item hover accent,
 * NO entrance animation — exit fade 120ms only.
 */
const MENU_CLASS =
  'w-64 rounded-[6px] border border-border bg-popover p-1 shadow-md duration-[120ms]! ease-in! data-starting-style:scale-100! data-starting-style:opacity-100! data-ending-style:scale-100!'
const ITEM_CLASS =
  'rounded-[4px] px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50'
const TRIGGER_CLASS =
  'flex h-8 items-center gap-1.5 rounded-[6px] px-2 text-left outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
const TILE = 'inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-muted'

/**
 * Topbar organization switcher — the ONE place the current workspace shows in
 * the app chrome (the topbar keeps the app brand; the sidebar stays nav-only).
 * Single org: a static face (name + role) so there's no fake affordance.
 * Multiple orgs: Notion popover listing every org registered under the user,
 * current one checkmarked; selecting one sets the org cookie and refreshes.
 */
export default function OrgPill({
  orgs,
  currentAuth0Id,
}: {
  orgs: MyOrg[]
  currentAuth0Id: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!orgs.length) return null

  const current = orgs.find((o) => o.org_auth0_id === currentAuth0Id) ?? orgs[0]
  const label = current.display_name ?? 'Organization'
  const multi = orgs.length > 1

  const face = (
    <>
      <span className={TILE}>
        <Building2 className="size-3 text-muted-foreground" />
      </span>
      <span className="min-w-0 truncate text-sm text-foreground/90">{label}</span>
      <span className="hidden shrink-0 items-center gap-1 text-label leading-none text-muted-foreground capitalize md:inline-flex">
        <span className={cn('inline-block size-1.5 rounded-full', ROLE_DOT[current.role])} />
        {roleLabel(current.role)}
      </span>
      {multi && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />}
    </>
  )

  // Single org — informational face, no dropdown.
  if (!multi) {
    return (
      <div
        className="hidden h-8 max-w-[260px] items-center gap-1.5 rounded-[6px] px-2 sm:flex"
        aria-label={`Workspace: ${label}`}
      >
        {face}
      </div>
    )
  }

  const onSelect = (orgId: string) => {
    if (orgId === current.org_auth0_id) return
    setOrgCookie(orgId)
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="hidden sm:block">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch organization"
          className={cn(TRIGGER_CLASS, 'max-w-[260px]', isPending && 'opacity-60')}
        >
          {face}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className={MENU_CLASS}>
          {/* Base UI GroupLabel requires a Menu.Group ancestor. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {orgs.map((org) => {
              const name = org.display_name ?? org.org_auth0_id.slice(0, 18)
              const isActive = org.org_auth0_id === current.org_auth0_id
              return (
                <DropdownMenuItem
                  key={org.org_auth0_id}
                  onClick={() => onSelect(org.org_auth0_id)}
                  className={cn(ITEM_CLASS, isActive && 'bg-accent')}
                >
                  <span
                    className={cn(
                      'inline-block size-1.5 shrink-0 rounded-full',
                      ROLE_DOT[org.role],
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-none">{name}</span>
                    <span className="block text-xs leading-none text-muted-foreground capitalize">
                      {roleLabel(org.role)}
                    </span>
                  </span>
                  {isActive && <Check className="size-4 shrink-0 text-foreground!" />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
