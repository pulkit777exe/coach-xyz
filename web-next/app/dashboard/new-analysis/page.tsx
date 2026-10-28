import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import DashboardAnalyseClient from '@/components/dashboard/DashboardAnalyseClient'

export const metadata = {
  title: 'New Analysis | CoachXYZ',
}

export default async function NewAnalysisPage() {
  const session = await getSession()
  if (!session) redirect('/auth/login')

  const auth0Id = session.user.sub
  return <DashboardAnalyseClient auth0Id={auth0Id} />
}