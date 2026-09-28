import { getSession } from '@/lib/session'
import { getOrgContext } from '@/lib/serverData'
import AppClient from '@/components/AppClient'

export const metadata = {
  title: 'CoachXYZ | AI Sports Form Analysis',
}

export default async function Home() {
  const session = await getSession()
  const auth0Id = session?.user?.sub ?? null
  // Signed-in coaches analyze for their active org so the club owns the row
  // and the quota; anonymous callers keep the legacy unattributed behavior.
  const orgCtx = session ? await getOrgContext().catch(() => null) : null

  return <AppClient auth0Id={auth0Id} orgAuth0Id={orgCtx?.auth0Id ?? null} />
}
