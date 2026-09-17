'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  House,
  Users,
  ClipboardCheck,
  CalendarDays,
  FileText,
  History,
  Sparkles,
  Settings,
  User,
} from 'lucide-react'

type NavItem = { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: string }
type NavGroup = { label: string | null; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Home', icon: House, exact: true },
    ],
  },
  {
    label: 'Roster',
    items: [
      { href: '/dashboard/students', label: 'Students', icon: Users },
      { href: '/dashboard/attendance', label: 'Attendance', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Planning',
    items: [
      { href: '/dashboard/schedule', label: 'Schedule', icon: CalendarDays },
      { href: '/dashboard/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { href: '/dashboard/history', label: 'History', icon: History },
      { href: '/', label: 'New Analysis', icon: Sparkles, exact: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/account', label: 'Account', icon: User, exact: true },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings, exact: true },
    ],
  },
  // Audit Log is planned but has no route yet — keep the group hidden
  // until /dashboard/audit ships to avoid duplicate /account hrefs.
  // {
  //   label: 'Security & Monitoring',
  //   items: [
  //     { href: '/dashboard/audit', label: 'Audit Log', icon: ShieldCheck },
  //   ],
  // },
]

export default function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col flex-1 gap-6 overflow-y-auto pb-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? 'home'}>
          {group.label && (
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {group.label}
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon, exact, badge }) => {
              const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
              const active = isActive
              return (
                <Link
                  key={href + label}
                  href={href}
                  className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className={`size-4 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
                  <span className="truncate">{label}</span>
                  {badge && (
                    <span className="ml-auto rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
