import { connection } from 'next/server'
import { getSession } from '@/lib/session'
import { getUserProfile, getMyOrgsCached, getOrgContext } from '@/lib/serverData'
import { appFace } from '@/lib/appFace'
import { redirect } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'
import MobileNavDrawer from '@/components/MobileNavDrawer'
import SidebarProfileMenu from '@/components/SidebarProfileMenu'
import SidebarSearch from '@/components/SidebarSearch'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Opt the whole segment into dynamic rendering BEFORE any session read. Without
  // this, `next build` attempts a static prerender, `headers()` throws Next's
  // dynamic-usage bailout, and the catch below logs it as an auth failure — 19
  // "Failed to get auth session" errors on every build. `connection()` is the
  // documented Next 16 opt-out and is already the convention in this app's pages.
  await connection()

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

  // Player accounts belong on /player, not the coach dashboard — but "player
  // account" is decided by ONE rule shared with the topbar (`lib/appFace`),
  // not by `users.role` alone: that column is written once, at account
  // creation (`linkPlayerToStudent`), and nothing ever writes `'coach'` back,
  // so gating on it alone bounced a head_coach whose account was born from a
  // student link out of their own club. A live staff membership anywhere
  // resolves the face to `dashboard`; every other case is exactly the old
  // account-only answer, so the redirect only ever stops firing for the
  // defect.
  //
  // Profile + org context resolve in parallel: neither depends on the
  // other's result (getOrgContext reads the session through its own cached
  // call), so serializing them costs a full round trip on every dashboard
  // navigation — and the face rule needs BOTH, so they are awaited together.
  // Redirect order is unchanged (session → face → render); only the PROFILE
  // rejection is caught as a value: redirect() throws a NEXT_REDIRECT digest
  // that a surrounding try/catch would swallow (logging it as a failure and
  // rendering the coach shell for players instead of redirecting).
  const profilePromise = getUserProfile(session.user.sub).then(
    ({ user }) => user?.role ?? null,
    (error: unknown) => {
      console.error('Failed to resolve dashboard role:', error)
      return null
    },
  )
  const orgPromise = Promise.all([getOrgContext(), getMyOrgsCached()]).then(
    ([ctx, myOrgs]) => ({ ctx, myOrgs }),
    (error: unknown) => {
      console.error('Failed to resolve org context:', error)
      return null
    },
  )
  const [profileRole, orgData] = await Promise.all([profilePromise, orgPromise])
  if (
    appFace({
      accountRole: profileRole,
      orgs: orgData?.myOrgs.orgs ?? [],
      ownSub: session.user.sub,
    }) === 'player'
  ) {
    redirect('/player')
  }

  // Org context — per-request cached via React.cache (getMyOrgsCached /
  // getOrgContext share the same deduped fetch, also used by the topbar
  // OrgPill). Failures fall back to session identity so a single-coach never
  // regresses. The sidebar itself is nav-only: brand stays in the topbar,
  // org context lives in the topbar OrgPill + the mobile drawer bar.
  let switcherCurrent = session.user.sub
  let navRole: Parameters<typeof DashboardNav>[0]['role'] = null
  let orgLabel: string | null = null
  if (orgData) {
    const { ctx, myOrgs } = orgData
    switcherCurrent = ctx.auth0Id
    navRole = ctx.role
    orgLabel =
      myOrgs.orgs.find((o) => o.org_auth0_id === ctx.auth0Id)?.display_name ??
      myOrgs.orgs[0]?.display_name ??
      null
  }

  // Mobile drawer bar — workspace context (org name), never the app name
  // (the brand lives in the topbar only).
  const drawerLabel = orgLabel ?? session.user.name ?? 'CoachXYZ'

  // Sidebar body — one source rendered twice: desktop aside + mobile drawer.
  const sidebarTop = (
    <>
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
    <div className="dashboard-shell flex min-h-screen bg-background dark:bg-[var(--marketing-dark)]">
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
        <MobileNavDrawer label={drawerLabel} footer={sidebarFooter}>
          {sidebarTop}
        </MobileNavDrawer>
        <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-auto bg-background dark:bg-[var(--marketing-dark)]">
          {children}
        </main>
      </div>
    </div>
  )
}
