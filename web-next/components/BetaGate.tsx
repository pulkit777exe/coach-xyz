'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { setBetaCode } from '@/lib/betaCode'

interface BetaGateProps {
  onSuccess: () => void
}

export default function BetaGate({ onSuccess }: BetaGateProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validateCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const normalizedCode = code.trim().toLowerCase()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/verify-code`, {
        headers: { 'x-beta-code': normalizedCode },
      })

      if (res.ok) {
        setBetaCode(normalizedCode)
        onSuccess()
        return
      }

      if (res.status === 401) {
        setError('Invalid code. Check your invite and try again.')
        return
      }

      setError('Could not verify your code right now. Please try again.')
    } catch {
      setError('Could not connect. Is the server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm mx-auto p-8 bg-gray-900 rounded-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-white">⚡ CoachAI</h1>
          <p className="mt-2 text-sm text-gray-300">You have been invited to the CoachAI beta.</p>
        </div>

        <form className="space-y-4" onSubmit={validateCode}>
          <input
            type="text"
            value={code.toUpperCase()}
            onChange={(event) => setCode(event.target.value.toLowerCase())}
            placeholder="Enter your code"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white placeholder:text-gray-500 uppercase focus:border-gray-500 focus:outline-none"
          />

          <Button type="submit" className="w-full" disabled={!code.trim() || loading}>
            {loading ? 'Verifying...' : 'Enter Beta'}
          </Button>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Don&apos;t have a code? You&apos;ll need an invite to access the beta.
        </p>
      </div>
    </div>
  )
}
