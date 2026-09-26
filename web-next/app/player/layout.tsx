import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { House } from 'lucide-react'
import SidebarProfileMenu from '@/components/SidebarProfileMenu'
import MobileNavDrawer from '@/components/MobileNavDrawer'

export default async function PlayerLayout({ children }: { children: React.ReactNode }) {
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

  // Sidebar body — one source rendered twice: desktop aside + mobile drawer.
  // Nav-only: the app brand lives in the topbar; the mobile bar shows the
  // player's own name (personal workspace), never an app name.
  const sidebarTop = (
    <>
      <nav className="flex flex-col">
        <Link
          href="/player"
          aria-current="page"
          className="flex h-7 items-center gap-2 rounded-[4px] bg-accent px-2 text-sm font-medium text-foreground outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <House className="size-4 shrink-0 text-foreground" />
          <span className="min-w-0 flex-1 truncate">My Hub</span>
        </Link>
      </nav>
    </>
  )

  // Footer block — account menu (Notion opens it upward from here)
  const sidebarFooter = (
    <SidebarProfileMenu
      name={session.user.name}
      email={session.user.email}
      picture={session.user.picture}
      settingsHref="/player/settings"
      variant="player"
    />
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — same Notion chrome as the dashboard shell; strictly below
          the fixed topbar so the footer stays on screen (see dashboard). */}
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">{sidebarTop}</div>
        <div className="shrink-0 border-t border-sidebar-border px-2 py-1.5">{sidebarFooter}</div>
      </aside>

      {/* Main column — below md the sidebar collapses into the drawer bar. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNavDrawer label={session.user.name ?? 'My hub'} footer={sidebarFooter}>
          {sidebarTop}
        </MobileNavDrawer>
        <main id="main" tabIndex={-1} className="flex-1 min-w-0 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  )
}
