import { getSession } from '@/lib/session'
import { getOrgContext } from '@/lib/serverData'
import AppClient from '@/components/AppClient'

export const metadata = {
  title: 'New Analysis | CoachXYZ',
  description: 'Upload training footage and get AI form analysis with chat.',
}

export default async function AnalyzePage() {
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext().catch(() => null)])
  const auth0Id = session?.user?.sub ?? null
  return <AppClient auth0Id={auth0Id} orgAuth0Id={orgCtx?.auth0Id ?? null} />
}