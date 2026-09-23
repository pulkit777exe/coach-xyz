import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgInvites, orgMembers } from '@/lib/serverData'
import MembersSection from '@/components/org/MembersSection'
import InvitesClient from '@/components/org/InvitesClient'
import PageHeader from '@/components/org/PageHeader'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Members | CoachXYZ',
  description: 'Manage staff, roles, and invitations.',
}

export default async function MembersPage() {
  noStore()
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const { auth0Id } = await getOrgContext()

  const [membersRes, invitesRes] = await Promise.all([
    orgMembers(auth0Id),
    orgInvites(auth0Id).catch(() => ({ invites: [] })),
  ])

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
