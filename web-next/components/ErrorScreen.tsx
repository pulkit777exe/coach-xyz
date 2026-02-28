'use client'

import { Button } from '@/components/ui/button'

interface ErrorScreenProps {
  code: string
  message: string
  onRetry: () => void
}

export default function ErrorScreen({ code, message, onRetry }: ErrorScreenProps) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <svg
          className="w-16 h-16 mx-auto mb-6 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>

        <h1 className="text-2xl font-semibold text-white mb-4">
          Something went wrong
        </h1>
        
        <p className="text-gray-400 mb-8">{message}</p>
        
        <p className="text-sm text-gray-600 mb-8">
          Error code: {code}
        </p>

        <Button
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
          size="lg"
          onClick={onRetry}
        >
          Try Again
        </Button>
      </div>
    </div>
  )
}
