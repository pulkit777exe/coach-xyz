import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgInvites, orgMembers } from '@/lib/serverData'
import AccessDenied from '@/components/AccessDenied'
import MembersSection from '@/components/org/MembersSection'
import InvitesClient from '@/components/org/InvitesClient'
import PageHeader from '@/components/org/PageHeader'
import { MEMBERS_NAV_ROLES } from '@/lib/nav'
import { MEMBER_INVITE_ROLES } from '@/lib/permissions'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Members | CoachXYZ',
  description: 'Manage staff, roles, and invitations.',
}

export default async function MembersPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx
  if (!MEMBERS_NAV_ROLES.includes(role)) {
    return <AccessDenied page="Members" allowedRoles={MEMBERS_NAV_ROLES} />
  }

  // `null` on rejection, not `{ invites: [] }`. An empty list is indistinguishable from a
  // failed read, so the header printed "0 pending" and the list said "No invitations yet." for
  // an org with four outstanding invitations. `null` is what lets `InvitesClient` tell them
  // apart — the same convention `app/dashboard/teams/page.tsx:44` uses for `teamsFailed`.
  const [membersRes, invitesRes] = await Promise.all([
    orgMembers(auth0Id),
    orgInvites(auth0Id).catch(() => null),
  ])

  return (
    <div className="bg-grid relative mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Members']}
        title="Members"
        description="Staff roles and single-use invitations."
      />

      <div className="mt-6 space-y-6">
        <MembersSection auth0Id={auth0Id} initialData={membersRes} />
        <InvitesClient
          auth0Id={auth0Id}
          invitesFailed={invitesRes === null}
          // Null on a FAILED read, so the prop takes an empty list — `invitesFailed` is what
          // the client renders from; passing the null through would crash it. The two are
          // separate signals on purpose: one is the data, one is whether the data is trustworthy.
          initialInvites={invitesRes?.invites ?? []}
          canInvite={MEMBER_INVITE_ROLES.includes(role)}
        />
      </div>
    </div>
  )
}
