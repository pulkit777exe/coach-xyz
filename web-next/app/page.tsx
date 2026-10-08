import { getSession } from '@/lib/session'
import { getOrgContext } from '@/lib/serverData'
import AppClient from '@/components/AppClient'

export const metadata = {
  title: 'CoachXYZ | AI Sports Form Analysis',
}

export default async function Home() {
  // Signed-in coaches analyze for their active org so the club owns the row
  // and the quota; anonymous callers keep the legacy unattributed behavior.
  //
  // Both promises are started together and awaited together, because they are
  // INDEPENDENT: `getOrgContext` reads the session through its own cached
  // `getSession()` (`serverData.ts:145`), and `lib/session.ts` wraps `getSession` in
  // React's `cache()`, so the two calls share one in-flight promise rather than issuing
  // two. Awaiting the session first therefore cost a full extra round trip on the
  // highest-traffic route in the app for no ordering requirement.
  //
  // The unconditional `getOrgContext()` is safe where the old `session ? … : null` guard
  // was not obviously so: it resolves `ownSub` from the same shared session promise, so
  // an anonymous caller gets `ownSub === undefined` and falls through to owner-of-self
  // exactly as before. The `.catch` is kept — an unauthenticated `/` must not 500 because
  // a cookie read or membership lookup failed.
  const [session, orgCtx] = await Promise.all([getSession(), getOrgContext().catch(() => null)])
  const auth0Id = session?.user?.sub ?? null

  return <AppClient auth0Id={auth0Id} orgAuth0Id={orgCtx?.auth0Id ?? null} />
}
