import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { getOrgContext, getDashboardAnalysisDetail } from '@/lib/serverData'
import { redirect } from 'next/navigation'
import { unstable_noStore as noStore } from 'next/cache'
import AnalysisDetailClient from '@/components/AnalysisDetailClient'
import { analysisDetailCapabilities } from '@/lib/permissions'
import { isCoachAIError } from '@/lib/errors'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Analysis ${id.slice(0, 8)} | CoachXYZ`,
    description: 'Detailed analysis results and form scoring.',
  }
}

export default async function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) {
    redirect('/auth/login')
  }
  const { auth0Id, role } = orgCtx
  const capabilities = analysisDetailCapabilities(role)

  let data = null
  let loadFailed = false
  try {
    const res = await getDashboardAnalysisDetail(auth0Id, id)
    data = res.analysis
  } catch (err) {
    console.error('Failed to load analysis detail:', err)
    loadFailed = isCoachAIError(err) ? err.retryable : true
  }

  return (
    <AnalysisDetailClient
      auth0Id={auth0Id}
      jobId={id}
      initialLoadFailed={loadFailed}
      initialData={data}
      canShareTokens={capabilities.canShareTokens}
      canLinkToStudent={capabilities.canLinkToStudent}
    />
  )
}
