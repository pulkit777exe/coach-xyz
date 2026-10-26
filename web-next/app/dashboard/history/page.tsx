import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { getDashboardAnalyses, getOrgContext } from '@/lib/serverData'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/org/PageHeader'
import EmptyState from '@/components/org/EmptyState'
import StatusPill from '@/components/org/StatusPill'
import { Button } from '@/components/9ui/ui/button'
import { HISTORY_NAV_ROLES } from '@/lib/nav'
import { unstable_noStore as noStore } from 'next/cache'
import { formatDateMed } from '@/lib/date'

export const metadata: Metadata = {
  title: 'History | CoachXYZ',
  description: 'Browse all your past video analyses.',
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  noStore()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) {
    redirect('/auth/login')
  }
  const { role } = orgCtx
  if (!HISTORY_NAV_ROLES.includes(role)) {
    return <AccessDenied page="History" allowedRoles={HISTORY_NAV_ROLES} />
  }
  // Scope the account-data route to the resolved org identity. An invited
  // coach's session sub is their own account, while the org context may point
  // at the owner/org id that owns the analysis rows.
  const auth0Id = orgCtx.auth0Id
  const params = await searchParams
  const rawPage = Number(params.page)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const perPage = 20
  const offset = (page - 1) * perPage

  // Fetch one extra to detect whether a next page exists without a separate count query
  let analyses: Awaited<ReturnType<typeof getDashboardAnalyses>>['analyses'] = []
  let hasNextPage = false
  let error = null

  try {
    const res = await getDashboardAnalyses(auth0Id, perPage + 1, offset)
    hasNextPage = res.analyses.length > perPage
    analyses = res.analyses.slice(0, perPage)
  } catch (err) {
    console.error('Failed to load history:', err)
    error = err instanceof Error ? err.message : 'Failed to load history'
  }

  return (
    <div className="bg-grid relative mx-auto max-w-[1080px] px-6 py-6 lg:px-8">
      <PageHeader
        trail={['Home', 'History']}
        title="All Analyses"
        description="Browse all your past video analyses."
      />

      {/* Mutually exclusive on purpose. These two used to render together: on a failed
          read `analyses` is still `[]`, so a coach saw a red banner AND a "No analyses
          found — Upload a video" card with a live Start button. The state that invites a
          DUPLICATE upload was the prominent one. `error` is assigned nowhere else, so
          it can gate the list outright rather than being a banner above it. */}
      {error ? (
        <div className="rounded-[6px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-body text-destructive">
          Failed to load history. Please try again later.
        </div>
      ) : analyses.length === 0 ? (
        <div className="rounded-[6px] border border-border bg-card">
          <EmptyState
            title="No analyses found"
            description="Upload a video to run your first analysis."
            action={
              <Button nativeButton={false} render={<Link href="/" />}>
                Start Your First Analysis
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="rounded-[6px] border border-border bg-card">
            {analyses.map((a) => (
              <Link
                key={a.server_job_id}
                href={`/dashboard/analysis/${a.server_job_id}`}
                className="flex h-[72px] items-center justify-between gap-4 border-b border-border px-4 transition-colors duration-150 last:border-b-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [content-visibility:auto] [contain-intrinsic-size:auto_72px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium leading-[1.4] text-foreground">
                    {a.display_name || a.file_name || 'Untitled'}
                    {a.player_index !== null && ` — Player ${a.player_index}`}
                  </p>
                  <div className="mt-0.5 flex items-center gap-3 text-meta text-muted-foreground">
                    <span>{formatDateMed(a.requested_at)}</span>
                    <span>{a.model}</span>
                    {a.file_size_bytes ? (
                      <span className="tabular-nums">
                        {(a.file_size_bytes / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    ) : null}
                    {a.download_count > 0 ? (
                      <span className="tabular-nums">
                        {a.download_count} download{a.download_count > 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-3">
                  {a.summary_json &&
                  typeof a.summary_json === 'object' &&
                  'form_score' in a.summary_json ? (
                    <div className="text-right">
                      <p className="text-[18px] font-semibold leading-none tabular-nums text-foreground">
                        {(a.summary_json as { form_score: number }).form_score}
                      </p>
                      <p className="mt-1 text-label font-medium uppercase leading-none tracking-[0.08em] text-muted-foreground">
                        Score
                      </p>
                    </div>
                  ) : null}
                  <StatusPill tone={a.complete ? 'green' : a.error_code ? 'red' : 'amber'}>
                    {a.complete ? 'Done' : a.error_code ? 'Failed' : 'Running'}
                  </StatusPill>
                </div>
              </Link>
            ))}
          </div>

          {(page > 1 || hasNextPage) && (
            <div className="mt-6 flex justify-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/dashboard/history?page=${page - 1}`} />}
                >
                  Previous
                </Button>
              ) : null}
              {hasNextPage ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/dashboard/history?page=${page + 1}`} />}
                >
                  Next
                </Button>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
