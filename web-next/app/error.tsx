'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <h2 className="text-white text-xl font-semibold mb-4">Something went wrong</h2>
        <p className="text-gray-400 mb-6">
          {error?.message || 'An unexpected error occurred.'}
        </p>
        {error?.digest && (
          <p className="text-gray-500 text-sm mb-4">Error ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
