import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export const metadata = { title: 'Sign up | CoachXYZ' }

const perks = ['6 sports', '60s analysis', 'Reports']

export default function SignupPage() {
  return (
    <main id="main" tabIndex={-1} className="grid min-h-[calc(100vh-56px)] place-items-center bg-white px-6 py-10 dark:bg-[#191919]">
      <div className="w-full max-w-[400px] rounded-[8px] border border-[rgba(55,53,47,0.09)] bg-white p-6 text-sm text-[#37352f] dark:border-[rgba(255,255,255,0.08)] dark:bg-[#191919] dark:text-[#ececec]">
        <span className="inline-flex rounded-full border border-[#2383e2]/30 bg-[#2383e2]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#2383e2] dark:text-[#4da3ec]">
          New
        </span>
        <h1 className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.01em]">
          Create your coaching workspace
        </h1>
        <p className="mt-1.5 text-sm text-[#787774] dark:text-[#9b9b9b]">
          Free for up to 5 athletes. No credit card required.
        </p>
        <div className="mt-6">
          <Button
            nativeButton={false}
            render={<a href="/auth/login?screen_hint=signup" />}
            className="h-10 w-full rounded-[6px] bg-[#2383e2] text-sm font-medium text-white hover:bg-[#1b6fb8]"
          >
            Sign up with Auth0
          </Button>
          <p className="mt-4 text-center text-xs text-[#787774] dark:text-[#9b9b9b]">
            Already have an account?{' '}
            <Link
              href="/login"
              className="rounded-[4px] font-medium text-[#2383e2] transition-colors duration-[120ms] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:text-[#4da3ec]"
            >
              Log in
            </Link>
          </p>
        </div>
        {/* hairline divider + perks */}
        <div className="mt-6 border-t border-[rgba(55,53,47,0.09)] pt-4 dark:border-[rgba(255,255,255,0.08)]">
          <ul className="grid grid-cols-3 gap-3 text-center">
            {perks.map((perk) => (
              <li
                key={perk}
                className="flex flex-col items-center gap-1 text-xs text-[#787774] dark:text-[#9b9b9b]"
              >
                <Check className="size-4 text-[#0f7b6c]" aria-hidden />
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}
