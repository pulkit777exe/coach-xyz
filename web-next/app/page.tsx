import { getSession } from '@/lib/session'
import AppClient from '@/components/AppClient'

export const metadata = {
  title: 'CoachXYZ | AI Sports Form Analysis',
}

export default async function Home() {
  const session = await getSession()
  const auth0Id = session?.user?.sub ?? null

  return <AppClient auth0Id={auth0Id} />
}
