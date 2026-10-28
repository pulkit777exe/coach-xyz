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

  return <HistoryChat auth0Id={auth0Id} initialAnalysis={result.analysis} />
}
