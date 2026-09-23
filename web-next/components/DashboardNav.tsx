'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  House,
  Users,
  UserCheck,
  Shield,
  ShieldCheck,
  ClipboardCheck,
  CalendarDays,
  FileText,
  History,
  Sparkles,
  Settings,
  User,
} from 'lucide-react'

import {
  ALL_NON_PLAYER_ROLES,
  AUDIT_NAV_ROLES,
  MEMBERS_NAV_ROLES,
  visibleNavGroups,
  type NavRole,
} from '@/lib/nav'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  badge?: string
  /** Roles allowed to see this item; undefined = every dashboard role. */
  roles?: readonly NavRole[]
}
type NavGroup = { label: string | null; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Home', icon: House, exact: true }],
  },
  {
    label: 'Roster',
    items: [
      { href: '/dashboard/students', label: 'Students', icon: Users, roles: ALL_NON_PLAYER_ROLES },
      { href: '/dashboard/teams', label: 'Teams', icon: Shield, roles: ALL_NON_PLAYER_ROLES },
      {
        href: '/dashboard/members',
        label: 'Members',
        icon: UserCheck,
        roles: MEMBERS_NAV_ROLES,
      },
      {
        href: '/dashboard/attendance',
        label: 'Attendance',
        icon: ClipboardCheck,
        roles: ALL_NON_PLAYER_ROLES,
      },
    ],
  },
  {
    label: 'Planning',
    items: [
      {
        href: '/dashboard/schedule',
        label: 'Schedule',
        icon: CalendarDays,
        roles: ALL_NON_PLAYER_ROLES,
      },
      { href: '/dashboard/reports', label: 'Reports', icon: FileText, roles: ALL_NON_PLAYER_ROLES },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { href: '/dashboard/history', label: 'History', icon: History, roles: ALL_NON_PLAYER_ROLES },
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
  {
    label: 'Security & Monitoring',
    items: [
      {
        href: '/dashboard/audit',
        label: 'Audit Log',
        icon: ShieldCheck,
        roles: AUDIT_NAV_ROLES,
      },
    ],
  },
]

/**
 * Notion sidebar rows — shared at module scope so no component is defined
 * inside a component. Section rows are 28px/r4; the unlabeled top group
 * renders as the taller "tab" pill directly under search.
 */
const NAV_ROW_CLASS =
  'flex h-7 items-center gap-2 rounded-[4px] px-2 text-sm outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
const NAV_TAB_CLASS =
  'flex h-8 items-center gap-2 rounded-[6px] px-2 text-sm font-medium outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]'
const NAV_ACTIVE_CLASS = 'bg-accent text-foreground'
const NAV_IDLE_CLASS = 'text-foreground/90 hover:bg-accent'
const NAV_SECTION_LABEL_CLASS = 'px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground'

export default function DashboardNav({ role = null }: { role?: NavRole | null }) {
  const pathname = usePathname()
  const groups = visibleNavGroups(NAV_GROUPS, role)

  return (
    <nav className="flex min-h-0 flex-1 flex-col pb-3 pt-1">
      {groups.map((group) => (
        <div key={group.label ?? 'home'}>
          {group.label && (
            <p className={NAV_SECTION_LABEL_CLASS}>{group.label}</p>
          )}
          <div className="flex flex-col">
            {group.items.map(({ href, label, icon: Icon, exact, badge }) => {
              const isActive = exact
                ? pathname === href
                : pathname === href || pathname.startsWith(href + '/')
              const isTab = group.label === null
              return (
                <Link
                  key={href + label}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    isTab ? NAV_TAB_CLASS : NAV_ROW_CLASS,
                    isActive ? NAV_ACTIVE_CLASS : NAV_IDLE_CLASS,
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      isActive ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {badge ? (
                    <span className="shrink-0 rounded-[3px] bg-accent px-1.5 text-[9px] font-semibold leading-4 tracking-wider text-muted-foreground">
                      {badge}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
