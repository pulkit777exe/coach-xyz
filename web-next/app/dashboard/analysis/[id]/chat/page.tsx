import { getSession } from '@/lib/session'
import { getOrgContext, getDashboardAnalysisDetail } from '@/lib/serverData'
import type { DashboardAnalysis } from '@/lib/api'
import { notFound, redirect } from 'next/navigation'
import { unstable_noStore as noStore } from 'next/cache'
import Link from 'next/link'
import HistoryChat from '@/components/HistoryChat'

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  noStore()
  const session = await getSession()
  if (!session) {
    redirect('/auth/login')
  }
  const { auth0Id } = await getOrgContext()

  const result = await getDashboardAnalysisDetail(auth0Id, id).catch(() => null)
  if (!result?.analysis) {
    notFound()
  }

  const data: DashboardAnalysis = result!.analysis
  const chatLabel = data.display_name || data.file_name || 'Untitled'

  const summaryRaw = data.summary_json
  const summary =
    summaryRaw && typeof summaryRaw === 'object' && !Array.isArray(summaryRaw)
      ? (summaryRaw as Record<string, unknown>)
      : typeof summaryRaw === 'string'
        ? (() => {
            try {
              return JSON.parse(summaryRaw) as Record<string, unknown>
            } catch {
              return null
            }
          })()
        : null

  return (
    <div className="p-8 lg:p-12 max-w-3xl" style={{ height: 'calc(100dvh - 4rem)' }}>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/dashboard/analysis/${id}`}
          className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Back to Analysis
        </Link>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          History
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">/</span>
        <span className="max-w-48 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {chatLabel}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">/</span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-foreground">Chat</span>
      </div>
      <div className="rounded-[6px] border border-border" style={{ height: 'calc(100% - 3rem)' }}>
        <HistoryChat auth0Id={auth0Id} jobId={id} summary={summary} />
      </div>
    </div>
  )
}
