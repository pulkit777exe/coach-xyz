import type { Metadata } from 'next'
import { orgInvites, orgMembers } from '@/lib/serverData'
import MembersSection from '@/components/org/MembersSection'
import InvitesClient from '@/components/org/InvitesClient'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Members | CoachXYZ',
  description: 'Manage staff, roles, and invitations.',
}

export default async function MembersPage() {
  // orgMembers stays bare (throws into error.tsx); invites degrade to [].
  const { auth0Id, data } = await loadPage(
    'org',
    {
      members: ({ auth0Id }) => orgMembers(auth0Id),
      invites: ({ auth0Id }) => orgInvites(auth0Id),
    },
    { invites: { invites: [] } },
  )
  const membersRes = data.members
  const invitesRes = data.invites

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Members']}
        title="Members"
        description="Staff roles and single-use invitations."
      />

      <div className="mt-6 space-y-6">
        <MembersSection auth0Id={auth0Id} initialData={membersRes} />
        <InvitesClient auth0Id={auth0Id} initialInvites={invitesRes.invites} />
      </div>
    </div>
  )
}
