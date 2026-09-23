import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { House } from 'lucide-react'
import SidebarProfileMenu from '@/components/SidebarProfileMenu'

/** Workspace mark row — press/hover affordance for the workspace link. */
const WORKSPACE_LINK =
  'group flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-1 outline-none transition-[background-color,color,transform] duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'

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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar — same Notion chrome as the dashboard shell */}
      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="flex h-8 items-center px-1">
            <Link href="/player" className={WORKSPACE_LINK}>
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-primary text-[11px] leading-none font-bold text-primary-foreground">
                P
              </span>
              <span className="truncate text-sm font-medium text-foreground">player.xyz</span>
            </Link>
          </div>
          <nav className="mt-2 flex flex-col">
            <Link
              href="/player"
              aria-current="page"
              className="flex h-7 items-center gap-2 rounded-[4px] bg-accent px-2 text-sm font-medium text-foreground outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
            >
              <House className="size-4 shrink-0 text-foreground" />
              <span className="min-w-0 flex-1 truncate">My Hub</span>
            </Link>
          </nav>
        </div>
        {/* Footer block — account menu (Notion opens it upward from here) */}
        <div className="shrink-0 border-t border-sidebar-border px-2 py-1.5">
          <SidebarProfileMenu
            name={session.user.name}
            email={session.user.email}
            picture={session.user.picture}
            settingsHref="/player/settings"
            variant="player"
          />
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto bg-background">{children}</main>
    </div>
  )
}
