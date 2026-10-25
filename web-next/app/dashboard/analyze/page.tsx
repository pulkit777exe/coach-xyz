import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import AppClient from '@/components/AppClient'

export const metadata = {
  title: 'New Analysis | CoachXYZ',
}

export default async function AnalyzePage() {
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const auth0Id = session.user.sub
  return <AppClient auth0Id={auth0Id} />
}