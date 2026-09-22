import { describe, expect, test } from 'vitest'

import {
  AUDIT_NAV_ROLES,
  MEMBERS_NAV_ROLES,
  visibleNavGroups,
  type GatedNavGroup,
  type NavRole,
} from '../nav'

type Item = { href: string; label: string; roles?: readonly NavRole[] }

const groups: GatedNavGroup<Item>[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Home' }],
  },
  {
    label: 'Roster',
    items: [
      { href: '/dashboard/students', label: 'Students' },
      { href: '/dashboard/members', label: 'Members', roles: MEMBERS_NAV_ROLES },
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

  test('assistant coach, analyst, medical, and player see neither', () => {
    for (const role of ['assistant_coach', 'analyst', 'medical', 'player'] as const) {
      const seen = hrefs(role)
      expect(seen).not.toContain('/dashboard/members')
      expect(seen).not.toContain('/dashboard/audit')
      expect(seen).toContain('/dashboard/students')
    }
  })

  test('assistant coach keeps the coaching workflow pages', () => {
    expect(hrefs('assistant_coach')).toContain('/dashboard')
  })

  test('null role sees everything (unresolved-context fallback)', () => {
    expect(hrefs(null)).toContain('/dashboard/members')
    expect(hrefs(null)).toContain('/dashboard/audit')
  })

  test('emptied groups are dropped', () => {
    const result = visibleNavGroups(groups, 'player')
    expect(result.some((g) => g.label === 'Security & Monitoring')).toBe(false)
  })
})
