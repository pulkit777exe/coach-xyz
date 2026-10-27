import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import DashboardAnalyseClient from '@/components/dashboard/DashboardAnalyseClient'

export const metadata = {
  title: 'New Analysis | CoachXYZ',
  description: 'Upload a video, detect players, score form with Gemini AI, then chat about the results.',
}

/**
 * New analysis entry point inside the coach dashboard shell.
 *
 * The `app/dashboard/layout.tsx` layout is applied automatically by Next.js
 * and provides the sidebar, topbar, org context, and auth guards (redirects
 * unauthenticated users and player accounts). This page only resolves the
 * session `sub` and hands it to the client pipeline.
 *
 * This route contains only video-analysis UI — no landing/marketing content.
 */
export default async function AnalysePage() {
  const session = await getSession()
  if (!session) redirect('/auth/login')

  const auth0Id = session.user.sub
  return <DashboardAnalyseClient auth0Id={auth0Id} />
}
