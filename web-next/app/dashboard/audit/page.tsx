import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { getOrgContext, orgAuditLogs } from '@/lib/serverData'
import AccessDenied from '@/components/AccessDenied'
import AuditClient from '@/components/org/AuditClient'
import PageHeader from '@/components/org/PageHeader'
import { AUDIT_NAV_ROLES } from '@/lib/nav'
import { unstable_noStore as noStore } from 'next/cache'

export const metadata: Metadata = {
  title: 'Audit Log | CoachXYZ',
  description: 'Sensitive organization actions, newest first.',
}

export default async function AuditPage() {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) redirect('/auth/login')
  const { auth0Id, role } = orgCtx
  if (!AUDIT_NAV_ROLES.includes(role)) {
    return <AccessDenied page="Audit Log" allowedRoles={AUDIT_NAV_ROLES} />
  }

  let logs = null
  try {
    const res = await orgAuditLogs(auth0Id, 100)
    logs = res.logs
  } catch {
    logs = null
  }

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'Audit Log']}
        title="Audit Log"
        description="Sensitive organization actions, newest first."
      />

      <div className="mt-6">
        {logs === null ? (
          <p className="text-body leading-5 text-muted-foreground">
            Audit log unavailable — you may not have permission, or the history store is not
            configured.
          </p>
        ) : (
          <AuditClient initialLogs={logs} />
        )}
      </div>
    </div>
  )
}
