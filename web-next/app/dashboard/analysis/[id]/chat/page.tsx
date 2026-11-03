import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getDashboardAnalysisDetail, getOrgContext } from '@/lib/serverData'
import { getSession } from '@/lib/session'
import { connection } from 'next/server'
import HistoryChat from '@/components/HistoryChat'

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await connection()
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) {
    redirect('/auth/login')
  }
  const { auth0Id } = orgCtx

  const result = await getDashboardAnalysisDetail(auth0Id, id).catch(() => null)
  if (!result?.analysis) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/dashboard/analysis/${id}`}
          className="text-meta font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Analysis
        </Link>
        <h1 className="text-lead font-semibold text-foreground">AI Coach Chat</h1>
      </div>
      <div className="h-[calc(100vh-140px)] rounded-[6px] border border-border bg-card overflow-hidden">
        <HistoryChat auth0Id={auth0Id} initialAnalysis={result.analysis} />
      </div>
    </div>
  )
}
