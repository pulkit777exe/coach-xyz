'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/9ui/ui/button'
import { Spinner } from './Spinner'
import { leaveOrganization, type MyOrg } from '@/lib/meApi'
import { clearOrgCookie, getOrgCookie } from '@/lib/orgCookie'
import { errorMessageOf } from '@/lib/errors'

// Owners manage the club and players are managed by their coach — neither
// sees a leave control.
const LEAVABLE_ROLES: ReadonlySet<MyOrg['role']> = new Set([
  'admin',
  'head_coach',
  'assistant_coach',
  'coach',
  'analyst',
  'medical',
])

export default function LeaveOrganization({
  orgAuth0Id,
  orgName,
  role,
  onLeft,
}: {
  orgAuth0Id: string
  orgName: string | null
  role: MyOrg['role']
  onLeft?: (orgAuth0Id: string) => void
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!LEAVABLE_ROLES.has(role)) return null

  const leave = async () => {
    setLeaving(true)
    setError(null)
    try {
      await leaveOrganization(orgAuth0Id)
      // Leaving resets to your own org: drop the persisted selection only if
      // it pointed at the org just left.
      if (getOrgCookie() === orgAuth0Id) clearOrgCookie()
      onLeft?.(orgAuth0Id)
      router.replace('/dashboard')
      router.refresh()
    } catch (err) {
      setError(errorMessageOf(err, 'Failed to leave the organization'))
      setConfirming(false)
    } finally {
      setLeaving(false)
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Leave
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-muted-foreground">
        Leave {orgName ?? 'this organization'}? Your teams go back to the owner, analyses you ran
        stay with the club, and you lose access immediately.
      </p>
      {error && <p className="text-meta text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={leaving}>
          Stay
        </Button>
        <Button variant="destructive" size="sm" onClick={() => void leave()} disabled={leaving}>
          {leaving ? <Spinner /> : 'Leave organization'}
        </Button>
      </div>
    </div>
  )
}
