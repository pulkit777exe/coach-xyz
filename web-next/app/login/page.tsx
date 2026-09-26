import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'

export const metadata = { title: 'Log in | CoachXYZ' }

export default function LoginPage() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="grid min-h-[calc(100vh-56px)] place-items-center bg-background px-6 py-10"
    >
      <div className="w-full max-w-[400px] rounded-[8px] border border-border bg-background p-6 text-sm text-foreground-strong">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[6px] bg-primary text-xs font-bold text-primary-foreground">
            C
          </span>
          <span className="text-sm font-semibold">CoachXYZ</span>
        </div>
        <h1 className="mt-6 text-[24px] font-bold tracking-[-0.01em]">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Log in with your team account. We use secure Auth0.
        </p>
        <div className="mt-6">
          <Button
            nativeButton={false}
            render={<a href="/auth/login" />}
            className="h-10 w-full rounded-[6px] bg-primary text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Continue with Auth0
          </Button>
          {/* hairline "or" divider */}
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-foreground/9 dark:bg-white/8" />
            or
            <span className="h-px flex-1 bg-foreground/9 dark:bg-white/8" />
          </div>
          <Button
            nativeButton={false}
            render={<a href="/signup" />}
            variant="outline"
            className="h-10 w-full rounded-[6px] border-input bg-transparent text-sm font-medium text-link hover:bg-muted"
          >
            Create an account →
          </Button>
        </div>
        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
          By continuing you agree to our{' '}
          <Link
            href="/terms"
            className="rounded-[4px] text-link transition-colors duration-[120ms] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Terms
          </Link>{' '}
          and{' '}
          <Link
            href="/privacy"
            className="rounded-[4px] text-link transition-colors duration-[120ms] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            Privacy
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
