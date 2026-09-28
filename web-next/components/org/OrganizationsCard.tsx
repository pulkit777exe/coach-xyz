'use client'

import { useState } from 'react'

import LeaveOrganization from './LeaveOrganization'
import { ORG_MEMBER_ROLE_LABELS, type OrgMemberRole } from '@/lib/members'
import type { MyOrg } from '@/lib/meApi'

// Organizations the caller belongs to, with self-service leave. Rendered on
// the account page; a failed orgs fetch hides the card instead of breaking
// the page.
export default function OrganizationsCard({
  initialOrgs,
}: {
  initialOrgs: MyOrg[] | null
}) {
  const [orgs, setOrgs] = useState<MyOrg[] | null>(initialOrgs)

  if (orgs === null) {
    return (
      <div className="mt-4 rounded-[6px] border border-border bg-card">
        <div className="border-b border-border px-6 py-3.5">
          <p className="text-lead font-semibold text-foreground">Organizations</p>
        </div>
        <p className="px-6 py-4 text-meta text-muted-foreground">
          Could not load your organizations right now.
        </p>
      </div>
    )
  }

  if (orgs.length === 0) return null

  return (
    <div className="mt-4 rounded-[6px] border border-border bg-card">
      <div className="border-b border-border px-6 py-3.5">
        <p className="text-lead font-semibold text-foreground">Organizations</p>
      </div>
      <ul className="divide-y divide-border">
        {orgs.map((org) => (
          <li key={org.org_auth0_id} className="px-6 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-foreground">
                  {org.display_name ?? org.org_auth0_id}
                </p>
                <p className="mt-0.5 text-meta text-muted-foreground">
                  {ORG_MEMBER_ROLE_LABELS[org.role as OrgMemberRole] ?? org.role}
                </p>
              </div>
              <LeaveOrganization
                orgAuth0Id={org.org_auth0_id}
                orgName={org.display_name}
                role={org.role}
                onLeft={(leftId) =>
                  setOrgs((prev) => (prev ?? []).filter((o) => o.org_auth0_id !== leftId))
                }
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
