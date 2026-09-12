'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/students', label: 'Students', exact: false },
  { href: '/dashboard/attendance', label: 'Attendance', exact: false },
  { href: '/dashboard/schedule', label: 'Schedule', exact: false },
  { href: '/dashboard/reports', label: 'Reports', exact: false },
  { href: '/dashboard/history', label: 'History', exact: false },
  { href: '/', label: 'New Analysis', exact: true },
  { href: '/account', label: 'Account', exact: true },
]

export default function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1 flex-1">
      {NAV_ITEMS.map(({ href, label, exact }) => {
        const isActive = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 text-[0.65rem] uppercase tracking-[0.2em] transition-colors ${
              isActive
                ? 'text-(--fg) bg-(--cream-05)'
                : 'text-(--cream-40) hover:text-(--fg)'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
