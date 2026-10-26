import Link from 'next/link'
import { Lock } from 'lucide-react'

import { Button } from '@/components/9ui/ui/button'
import EmptyState from '@/components/org/EmptyState'
import PageHeader from '@/components/org/PageHeader'
import { ORG_MEMBER_ROLE_LABELS, type OrgMemberRole } from '@/lib/members'

/**
 * Role-floor blocked view — rendered *instead of* a gated page body when the
 * caller's org role is not in the page's allowed set. Keeps the page title +
 * breadcrumb (Notion shows the page name even when access is denied) and
 * explains which roles can open it, so a direct URL or stale link never shows
 * a blank screen or a 403 from a data fetch further down.
 *
 * Gating is UX, not security: the server enforces the same floors (see the
 * role matrix in docs/CODEBASE_MAP.md).
 */
export default function AccessDenied({
  page,
  allowedRoles,
}: {
  /** Page name for the breadcrumb + header. */
  page: string
  /** Org roles allowed to open this page (mirrors the nav gate). */
  allowedRoles: readonly OrgMemberRole[]
}) {
  const labels = allowedRoles.map((role) => ORG_MEMBER_ROLE_LABELS[role]).join(', ')

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader trail={['Home', page]} title={page} />
      <EmptyState
        icon={<Lock className="h-5 w-5" aria-hidden="true" />}
        title="You don't have access to this page"
        description={`This page is limited to ${labels}. Ask an org owner if you think your role should change.`}
        action={
          <Button nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        }
      />
    </div>
  )
}
