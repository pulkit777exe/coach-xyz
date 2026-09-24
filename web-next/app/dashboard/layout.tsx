import { getSession } from '@/lib/session'
import { getUserProfile } from '@/lib/api'
import { getMyOrgsCached, getOrgContext } from '@/lib/serverData'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import DashboardNav from '@/components/DashboardNav'
import MobileNavDrawer from '@/components/MobileNavDrawer'
import NotificationBell from '@/components/notifications/NotificationBell'
import SidebarProfileMenu from '@/components/SidebarProfileMenu'
import SidebarSearch from '@/components/SidebarSearch'
import OrgSwitcher from '@/components/org/OrgSwitcher'

/** Workspace mark row — press/hover affordance for the workspace link. */
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

  // Sidebar body — one source rendered twice: desktop aside + mobile drawer.
  const sidebarTop = (
    <>
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
    </>
  )

  // Footer block — account menu (Notion opens it upward from here)
  const sidebarFooter = (
    <SidebarProfileMenu
      name={session.user.name}
      email={session.user.email}
      picture={session.user.picture}
      settingsHref="/dashboard/settings"
      variant="dashboard"
    />
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — Notion chrome: 240px, hairline border on bg-sidebar,
          internal scroll region with a bottom-pinned footer block. Sits
          strictly below the fixed topbar (top-14) so the footer never hangs
          below the fold and the workspace row never slides under the header. */}
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">{sidebarTop}</div>
        <div className="shrink-0 border-t border-sidebar-border px-2 py-1.5">{sidebarFooter}</div>
      </aside>

      {/* Main column — below md the sidebar collapses into the drawer bar. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNavDrawer label="coach.xyz" footer={sidebarFooter}>
          {sidebarTop}
        </MobileNavDrawer>
        <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-auto bg-background">{children}</main>
      </div>
    </div>
  )
}
