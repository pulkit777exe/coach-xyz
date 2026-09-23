'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'

import type { MyOrg } from '@/lib/meApi'
import { ORG_COOKIE } from '@/lib/orgCookie'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/9ui/ui/dropdown-menu'
import { cn } from '@/lib/utils'

function setOrgCookie(orgId: string) {
  const isLocal =
    typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(window.location.hostname)
  document.cookie = `${ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; max-age=31536000; samesite=lax${isLocal ? '' : '; Secure'}`
}

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

/**
 * Notion popover pattern: hairline panel, radius 6, item hover accent,
 * NO entrance animation — exit fade 120ms only.
 */
const MENU_CLASS =
  'w-64 rounded-[6px] border border-border bg-popover p-1 shadow-md duration-[120ms]! ease-in! data-starting-style:scale-100! data-starting-style:opacity-100! data-ending-style:scale-100!'
const ITEM_CLASS =
  'rounded-[4px] px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50'
const TRIGGER_CLASS =
  'flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
const AVATAR_TILE = 'inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-muted'

export default function OrgSwitcher({
  orgs,
  currentAuth0Id,
}: {
  orgs: MyOrg[]
  currentAuth0Id: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!orgs.length) return null

  const current = orgs.find((o) => o.org_auth0_id === currentAuth0Id) ?? orgs[0]
  const label = current.display_name ?? 'Organization'
  const role = current.role

  // Single-org: show static org context (no dropdown) — keep the sidebar tidy.
  if (orgs.length === 1) {
    return (
      <div className="mt-1 mb-1.5 flex items-center gap-2 rounded-[6px] px-2 py-1.5">
        <span className={AVATAR_TILE}>
          <Building2 className="size-3 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-none text-foreground/90">{label}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground/60 capitalize">
            <span className={cn('inline-block size-1.5 rounded-full', ROLE_DOT[role])} />
            {role}
          </p>
        </div>
      </div>
    )
  }

  const onSelect = (orgId: string) => {
    if (orgId === currentAuth0Id) return
    setOrgCookie(orgId)
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="mt-1 mb-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch organization"
          className={cn(TRIGGER_CLASS, isPending && 'opacity-60')}
        >
          <span className={AVATAR_TILE}>
            <Building2 className="size-3 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className={MENU_CLASS}>
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            Organizations
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {orgs.map((org) => {
            const name = org.display_name ?? org.org_auth0_id.slice(0, 18)
            const isActive = org.org_auth0_id === currentAuth0Id
            return (
              <DropdownMenuItem
                key={org.org_auth0_id}
                onClick={() => onSelect(org.org_auth0_id)}
                className={cn(ITEM_CLASS, isActive && 'bg-accent')}
              >
                <span
                  className={cn('inline-block size-1.5 shrink-0 rounded-full', ROLE_DOT[org.role])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-none">{name}</span>
                  <span className="block text-xs leading-none text-muted-foreground capitalize">
                    {org.role}
                  </span>
                </span>
                {isActive && <Check className="size-4 shrink-0 text-foreground!" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
