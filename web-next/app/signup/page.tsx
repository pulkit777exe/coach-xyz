import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export const metadata = { title: 'Sign up | CoachXYZ' }

const perks = ['6 sports', '60s analysis', 'Reports']

export default function SignupPage() {
  return (
    <main id="main" tabIndex={-1} className="grid min-h-[calc(100vh-56px)] place-items-center bg-background px-6 py-10">
      <div className="w-full max-w-[400px] rounded-[8px] border border-border bg-background p-6 text-sm text-foreground-strong">
        <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-label font-semibold text-link">
          New
        </span>
        <h1 className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.01em]">
          Create your coaching workspace
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Free for up to 5 athletes. No credit card required.
        </p>
        <div className="mt-6">
          <Button
            nativeButton={false}
            render={<a href="/auth/login?screen_hint=signup" />}
            className="h-10 w-full rounded-[6px] bg-primary text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Sign up with Auth0
          </Button>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/login"
              className="rounded-[4px] font-medium text-link transition-colors duration-[120ms] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Log in
            </Link>
          </p>
        </div>
        {/* hairline divider + perks */}
        <div className="mt-6 border-t border-border pt-4">
          <ul className="grid grid-cols-3 gap-3 text-center">
            {perks.map((perk) => (
              <li
                key={perk}
                className="flex flex-col items-center gap-1 text-xs text-muted-foreground"
              >
                <Check className="size-4 text-check" aria-hidden />
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}
