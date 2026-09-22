'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/9ui/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/9ui/ui/card'
import { acceptInvite } from '@/lib/meApi'

export default function AcceptInviteClient() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>(
    token ? 'working' : 'idle',
  )
  const [message, setMessage] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    if (!token || state !== 'working') return
    let cancelled = false
    acceptInvite(token)
      .then((res) => {
        if (cancelled) return
        setRole(res.role)
        setState('done')
      })
      .catch((e) => {
        if (cancelled) return
        setMessage(e instanceof Error ? e.message : 'This invitation is invalid or expired.')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [token, state])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Organization invitation</CardTitle>
          <CardDescription>
            {state === 'done'
              ? `Accepted — you joined as ${role}.`
              : 'Redeem your single-use invite link.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && (
            <p className="text-sm text-destructive">
              Missing invitation token. Ask your coach for a fresh link.
            </p>
          )}
          {state === 'working' && (
            <p className="text-sm text-muted-foreground">Accepting invitation…</p>
          )}
          {state === 'error' && <p className="text-sm text-destructive">{message}</p>}
          {state === 'done' && <Button render={<Link href="/dashboard" />}>Open dashboard</Button>}
          {state === 'error' && token && (
            <Button onClick={() => setState('working')}>Try again</Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
