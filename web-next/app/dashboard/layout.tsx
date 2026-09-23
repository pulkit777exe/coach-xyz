import { getSession } from '@/lib/session'
import { getUserProfile } from '@/lib/api'
import { getMyOrgsCached, getOrgContext } from '@/lib/serverData'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogOut, Settings } from 'lucide-react'
import UserAvatar from '@/components/UserAvatar'
import DashboardNav from '@/components/DashboardNav'
import NotificationBell from '@/components/notifications/NotificationBell'
import SidebarSearch from '@/components/SidebarSearch'
import OrgSwitcher from '@/components/org/OrgSwitcher'

/** 28px sidebar ghost icon button — Notion footer/top row. */
const SIDEBAR_ICON_BUTTON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
/** Workspace mark row — same press/hover affordance as the icon buttons. */
const WORKSPACE_LINK =
  'group flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-1 outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let session
  try {
    session = await getSession()
  } catch (error) {
    console.error('Failed to get auth session:', error)
    redirect('/auth/login')
  }

  if (!session) {
    redirect('/auth/login')
  }

  // Player accounts belong on /player, not the coach dashboard.
  try {
    const { user } = await getUserProfile(session.user.sub)
    if (user?.role === 'player') redirect('/player')
  } catch (error) {
    console.error('Failed to resolve dashboard role:', error)
  }

  // Org switcher data — per-request cached via React.cache (getMyOrgsCached /
  // getOrgContext share the same deduped fetch). Failures fall back to no
  // switcher so a single-coach never regresses.
  let switcherOrgs: Awaited<ReturnType<typeof getMyOrgsCached>>['orgs'] = []
  let switcherCurrent = session.user.sub
  let navRole: Parameters<typeof DashboardNav>[0]['role'] = null
  try {
    const [ctx, myOrgs] = await Promise.all([getOrgContext(), getMyOrgsCached()])
    switcherCurrent = ctx.auth0Id
    switcherOrgs = myOrgs.orgs
    navRole = ctx.role
  } catch (error) {
    console.error('Failed to resolve org switcher:', error)
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — Notion chrome: 240px, hairline border on bg-sidebar,
          internal scroll region with a bottom-pinned footer block. */}
      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {/* Top row: workspace mark + small ghost icon buttons */}
          <div className="flex h-8 items-center justify-between gap-1 px-1">
            <Link href="/" className={WORKSPACE_LINK}>
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-primary text-[11px] leading-none font-bold text-primary-foreground">
                C
              </span>
              <span className="truncate text-sm font-medium text-foreground">coach.xyz</span>
            </Link>
            <NotificationBell />
          </div>

          {switcherOrgs.length > 0 && (
            <OrgSwitcher orgs={switcherOrgs} currentAuth0Id={switcherCurrent} />
          )}

          <SidebarSearch auth0Id={switcherCurrent} role={navRole} />

          <DashboardNav role={navRole} />
        </div>

        {/* Footer block — avatar + account name, ghost icon actions */}
        <div className="shrink-0 border-t border-sidebar-border px-2 py-1.5">
          <div className="flex items-center gap-2 rounded-[6px] px-1 py-1">
            <UserAvatar
              picture={session.user.picture}
              name={session.user.name}
              email={session.user.email}
              size="sm"
            />
            <p
              className="min-w-0 flex-1 truncate text-sm text-foreground/90"
              title={session.user.email ?? undefined}
            >
              {session.user.name || session.user.email}
            </p>
            <Link href="/dashboard/settings" aria-label="Settings" className={SIDEBAR_ICON_BUTTON}>
              <Settings className="size-4" />
            </Link>
            <a href="/auth/logout" aria-label="Log out" className={SIDEBAR_ICON_BUTTON}>
              <LogOut className="size-4" />
            </a>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto bg-background">{children}</main>
    </div>
  )
}
