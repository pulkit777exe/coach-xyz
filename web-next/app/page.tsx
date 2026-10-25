import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import MarketingLanding from '@/components/MarketingLanding'

export const metadata = {
  title: 'CoachXYZ | AI Sports Form Analysis',
}

export default async function Home() {
  const session = await getSession()
  if (session) redirect('/dashboard')
  return <MarketingLanding />
}
