import { getSession } from '@/lib/session'
import { getUserProfile } from '@/lib/user'
import { getMyOrgsCached, getOrgContext } from '@/lib/serverData'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import UserAvatar from '@/components/UserAvatar'
import DashboardNav from '@/components/DashboardNav'
import NotificationBell from '@/components/notifications/NotificationBell'
import SidebarSearch from '@/components/SidebarSearch'
import OrgSwitcher from '@/components/org/OrgSwitcher'

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
    <div className="dashboard-shell flex bg-grid">
      {/* Sidebar — theme-aware (light: white, dark: near-black) */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-[var(--marketing-white)]/10 bg-[var(--marketing-dark-card)]">
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-6 flex items-center justify-between gap-2 px-2">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                C
              </span>
              <span className="text-sm font-semibold tracking-tight text-[var(--marketing-white)]">
                coach.xyz
              </span>
            </Link>
            <NotificationBell />
          </div>

          {switcherOrgs.length > 0 && (
            <OrgSwitcher orgs={switcherOrgs} currentAuth0Id={switcherCurrent} />
          )}

          <SidebarSearch auth0Id={switcherCurrent} role={navRole} />

          <DashboardNav role={navRole} />
        </div>

        <div className="border-t border-[var(--marketing-white)]/10 p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-white/5">
            <UserAvatar
              picture={session.user.picture}
              name={session.user.name}
              email={session.user.email}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--marketing-white)] leading-none">
                {session.user.name || session.user.email}
              </p>
              <p className="truncate text-xs text-[var(--marketing-white)]/60">{session.user.email}</p>
            </div>
          </div>
          <a
            href="/auth/logout"
            className="mt-2 flex items-center justify-center rounded-md border border-[var(--marketing-white)]/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-[var(--marketing-white)]/70 hover:bg-white/10 hover:text-[var(--marketing-white)]"
          >
            Log Out
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto relative">{children}</main>
    </div>
  )
}
