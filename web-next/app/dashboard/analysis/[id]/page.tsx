import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { getOrgContext, getDashboardAnalysisDetail } from '@/lib/serverData'
import { redirect } from 'next/navigation'
import { unstable_noStore as noStore } from 'next/cache'
import AnalysisDetailClient from '@/components/AnalysisDetailClient'
import { analysisDetailCapabilities } from '@/lib/permissions'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext()])
  if (!session) return { title: 'Analysis | CoachXYZ' }

  try {
    const { auth0Id } = orgCtx
    const res = await getDashboardAnalysisDetail(auth0Id, id)
    const a = res.analysis
    const label = a.display_name || a.file_name || id.slice(0, 8)
    const score =
      a.summary_json && typeof a.summary_json === 'object' && 'form_score' in a.summary_json
        ? ` — ${(a.summary_json as { form_score: number }).form_score}/10`
        : ''
    return {
      title: `${label}${score} | CoachXYZ`,
      description: a.complete ? `Analysis of ${label}${score}` : `Analysis in progress — ${label}`,
    }
  } catch {
    return { title: 'Analysis | CoachXYZ' }
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
  try {
    const res = await getDashboardAnalysisDetail(auth0Id, id)
    data = res.analysis
  } catch (err) {
    console.error('Failed to load analysis detail:', err)
    data = null
  }

  return (
    <AnalysisDetailClient
      auth0Id={auth0Id}
      jobId={id}
      initialData={data}
      canShareTokens={capabilities.canShareTokens}
      canLinkToStudent={capabilities.canLinkToStudent}
    />
  )
}
