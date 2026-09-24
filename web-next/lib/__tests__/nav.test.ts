import { describe, expect, test } from 'vitest'

import {
  ALL_NON_PLAYER_ROLES,
  ANALYZE_NAV_ROLES,
  AUDIT_NAV_ROLES,
  MEMBERS_NAV_ROLES,
  visibleNavGroups,
  type GatedNavGroup,
  type NavRole,
} from '../nav'

type Item = { href: string; label: string; roles?: readonly NavRole[] }

// Mirrors components/DashboardNav.tsx NAV_GROUPS — role gating only.
const groups: GatedNavGroup<Item>[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Home' }],
  },
  {
    label: 'Roster',
    items: [
      { href: '/dashboard/students', label: 'Students', roles: ALL_NON_PLAYER_ROLES },
      { href: '/dashboard/members', label: 'Members', roles: MEMBERS_NAV_ROLES },
    ],
  },
  {
    label: 'Planning',
    items: [{ href: '/dashboard/schedule', label: 'Schedule', roles: ALL_NON_PLAYER_ROLES }],
  },
  {
    label: 'Analysis',
    items: [
      { href: '/dashboard/history', label: 'History', roles: ALL_NON_PLAYER_ROLES },
      { href: '/', label: 'New Analysis', roles: ANALYZE_NAV_ROLES },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/account', label: 'Account' },
      { href: '/dashboard/settings', label: 'Settings' },
    ],
  },
  {
    label: 'Security & Monitoring',
    items: [{ href: '/dashboard/audit', label: 'Audit Log', roles: AUDIT_NAV_ROLES }],
  },
]

const hrefs = (role: NavRole | null): string[] =>
  visibleNavGroups(groups, role).flatMap((g) => g.items.map((i) => i.href))

describe('visibleNavGroups', () => {
  test('owner and admin see members and audit', () => {
    for (const role of ['owner', 'admin'] as const) {
      const seen = hrefs(role)
      expect(seen).toContain('/dashboard/members')
      expect(seen).toContain('/dashboard/audit')
    }
  })

  test('head coach and legacy coach see members but not audit', () => {
    for (const role of ['head_coach', 'coach'] as const) {
      const seen = hrefs(role)
      expect(seen).toContain('/dashboard/members')
      expect(seen).not.toContain('/dashboard/audit')
    }
  })

  test('assistant coach, analyst, and medical see students but not members or audit', () => {
    for (const role of ['assistant_coach', 'analyst', 'medical'] as const) {
      const seen = hrefs(role)
      expect(seen).not.toContain('/dashboard/members')
      expect(seen).not.toContain('/dashboard/audit')
      expect(seen).toContain('/dashboard/students')
    }
  })

  test('player sees only self-service pages (no roster, planning, or history)', () => {
    // Org players are blocked from every /api/org/* route server-side, so the
    // nav must not offer those links — only Home, New Analysis, Account, Settings.
    expect(hrefs('player')).toEqual(['/dashboard', '/', '/account', '/dashboard/settings'])
    expect(hrefs('player')).not.toContain('/dashboard/students')
    expect(hrefs('player')).not.toContain('/dashboard/schedule')
    expect(hrefs('player')).not.toContain('/dashboard/history')
  })

  test('assistant coach keeps the coaching workflow pages', () => {
    expect(hrefs('assistant_coach')).toContain('/dashboard')
    expect(hrefs('assistant_coach')).toContain('/dashboard/students')
  })

  test('null role sees everything (unresolved-context fallback)', () => {
    expect(hrefs(null)).toContain('/dashboard/members')
    expect(hrefs(null)).toContain('/dashboard/audit')
    expect(hrefs(null)).toContain('/dashboard/students')
  })

  test('emptied groups are dropped', () => {
    const result = visibleNavGroups(groups, 'player')
    expect(result.some((g) => g.label === 'Security & Monitoring')).toBe(false)
    expect(result.some((g) => g.label === 'Roster')).toBe(false)
    expect(result.some((g) => g.label === 'Planning')).toBe(false)
    // Home, New Analysis, Account survive for players.
    expect(result.some((g) => g.label === null)).toBe(true)
    expect(result.some((g) => g.label === 'Account')).toBe(true)
  })

  test('New Analysis is offered to every role except medical', () => {
    // Same floor as dashboardQuickActions.analyze (lib/permissions): medical
    // can neither create analyses nor read results, so neither nav, palette,
    // nor landing tile offers the link.
    expect(ANALYZE_NAV_ROLES).not.toContain('medical')
    for (const role of [
      'owner',
      'admin',
      'head_coach',
      'assistant_coach',
      'coach',
      'analyst',
      'player',
    ] as const) {
      expect(ANALYZE_NAV_ROLES, `role: ${role}`).toContain(role)
    }
    expect(hrefs('medical')).not.toContain('/')
    expect(hrefs('player')).toContain('/')
  })
})
