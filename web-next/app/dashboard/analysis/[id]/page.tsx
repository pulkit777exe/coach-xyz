import type { Metadata } from 'next'
import { getSession } from '@/lib/session'
import { getOrgContext, getDashboardAnalysisDetail } from '@/lib/serverData'
import AnalysisDetailClient from '@/components/AnalysisDetailClient'
import { loadPage } from '../../_shell'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const session = await getSession()
  if (!session) return { title: 'Analysis | CoachXYZ' }

  try {
    const { auth0Id } = await getOrgContext()
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
  const { id } = await params
  // Gate first so auth0Id is always defined for the client (even when the
  // detail fetch fails and renders its null state); the fetch keeps its own
  // try/catch, as before.
  const { auth0Id } = await loadPage('org', {})

  let data = null
  try {
    const { data: loaded } = await loadPage('org', {
      detail: ({ auth0Id }) => getDashboardAnalysisDetail(auth0Id, id),
    })
    data = loaded.detail.analysis
  } catch (err) {
    console.error('Failed to load analysis detail:', err)
    data = null
  }

  return <AnalysisDetailClient auth0Id={auth0Id} jobId={id} initialData={data} />
}
