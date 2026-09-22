import { getSession } from '@/lib/session'
import HeaderClient from './HeaderClient'

export default async function AuthHeader() {
  const session = await getSession()
  const user = session?.user
    ? {
        sub: session.user.sub,
        picture: session.user.picture ?? null,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }
    : null
  return <HeaderClient user={user} />
}
