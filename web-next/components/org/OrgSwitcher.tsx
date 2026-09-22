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
      <div className="mb-4 rounded-md border border-sidebar-border bg-card/50 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted">
            <Building2 className="size-3.5 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-none text-foreground">{label}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] capitalize leading-none text-muted-foreground">
              <span className={cn('inline-block size-1.5 rounded-full', ROLE_DOT[role])} />
              {role}
            </p>
          </div>
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
    <div className="mb-4">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch organization"
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-muted',
            isPending && 'opacity-60',
          )}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
            <Building2 className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-none text-foreground">
              {label}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] capitalize leading-none text-muted-foreground">
              <span className={cn('inline-block size-1.5 rounded-full', ROLE_DOT[role])} />
              {role}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-64">
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
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
                className={cn('flex items-center gap-2', isActive && 'bg-accent/60')}
              >
                <span
                  className={cn('inline-block size-1.5 shrink-0 rounded-full', ROLE_DOT[org.role])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-none">{name}</span>
                  <span className="block text-xs capitalize leading-none text-muted-foreground">
                    {org.role}
                  </span>
                </span>
                {isActive && <Check className="size-4 shrink-0 text-foreground" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
