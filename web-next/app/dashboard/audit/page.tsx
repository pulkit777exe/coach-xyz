import type { Metadata } from 'next'
import { orgAuditLogs } from '@/lib/serverData'
import AuditClient from '@/components/org/AuditClient'
import PageHeader from '@/components/org/PageHeader'
import { loadPage } from '../_shell'

export const metadata: Metadata = {
  title: 'Audit Log | CoachXYZ',
  description: 'Sensitive organization actions, newest first.',
}

export default async function AuditPage() {
  // Gate first so the log fetch below runs gated; the fetch keeps its own
  // try/catch so failures render the unavailable notice (not an empty list).
  await loadPage('org', {})

  let logs = null
  try {
    const { data } = await loadPage('org', {
      logs: ({ auth0Id }) => orgAuditLogs(auth0Id, 100),
    })
    logs = data.logs.logs
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
          <p className="text-sm text-muted-foreground">
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
