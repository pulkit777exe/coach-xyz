import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'

export const metadata = { title: 'Log in | CoachXYZ' }

export default function LoginPage() {
  return (
    <main id="main" tabIndex={-1} className="grid min-h-[calc(100vh-56px)] place-items-center bg-white px-6 py-10 dark:bg-[#191919]">
      <div className="w-full max-w-[400px] rounded-[8px] border border-[rgba(55,53,47,0.09)] bg-white p-6 text-sm text-[#37352f] dark:border-[rgba(255,255,255,0.08)] dark:bg-[#191919] dark:text-[#ececec]">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[6px] bg-[#2383e2] text-xs font-bold text-white">
            C
          </span>
          <span className="text-sm font-semibold">CoachXYZ</span>
        </div>
        <h1 className="mt-6 text-[24px] font-bold tracking-[-0.01em]">Welcome back</h1>
        <p className="mt-1.5 text-sm text-[#787774] dark:text-[#9b9b9b]">
          Log in with your team account. We use secure Auth0.
        </p>
        <div className="mt-6">
          <Button
            nativeButton={false}
            render={<a href="/auth/login" />}
            className="h-10 w-full rounded-[6px] bg-[#2383e2] text-sm font-medium text-white hover:bg-[#1b6fb8]"
          >
            Continue with Auth0
          </Button>
          {/* hairline "or" divider */}
          <div className="my-4 flex items-center gap-3 text-xs text-[#787774] dark:text-[#9b9b9b]">
            <span className="h-px flex-1 bg-[rgba(55,53,47,0.09)] dark:bg-[rgba(255,255,255,0.08)]" />
            or
            <span className="h-px flex-1 bg-[rgba(55,53,47,0.09)] dark:bg-[rgba(255,255,255,0.08)]" />
          </div>
          <Button
            nativeButton={false}
            render={<a href="/signup" />}
            variant="outline"
            className="h-10 w-full rounded-[6px] border-[rgba(55,53,47,0.15)] bg-transparent text-sm font-medium text-[#2383e2] hover:bg-[#f7f7f5] dark:border-[rgba(255,255,255,0.15)] dark:text-[#4da3ec] dark:hover:bg-[#202020]"
          >
            Create an account →
          </Button>
        </div>
        <p className="mt-5 text-center text-xs leading-5 text-[#787774] dark:text-[#9b9b9b]">
          By continuing you agree to our{' '}
          <Link
            href="/terms"
            className="rounded-[4px] text-[#2383e2] transition-colors duration-[120ms] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:text-[#4da3ec]"
          >
            Terms
          </Link>{' '}
          and{' '}
          <Link
            href="/privacy"
            className="rounded-[4px] text-[#2383e2] transition-colors duration-[120ms] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:text-[#4da3ec]"
          >
            Privacy
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
