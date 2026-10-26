import type { Metadata } from 'next'
import { Suspense } from 'react'
import AcceptInviteClient from '@/components/AcceptInviteClient'

export const metadata: Metadata = {
  title: 'Accept Invitation | CoachXYZ',
  description: 'Join your organization with a single-use invite link.',
}

export default function InvitePage() {
  return (
    <main id="main" tabIndex={-1}>
      <Suspense>
        <AcceptInviteClient />
      </Suspense>
    </main>
  )
}
