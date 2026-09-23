import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'

export const metadata: Metadata = { title: 'Page not found | CoachXYZ' }

/** Blue text-button action — important keeps the override deterministic vs the ghost variant. */
const ACTION_PRIMARY =
  'h-auto! px-1 text-sm font-medium text-primary! transition-colors hover:bg-transparent! hover:text-primary/80!'

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm rounded-[8px] border border-border bg-card p-8 text-center">
        <p className="text-[40px] leading-none font-bold text-muted-foreground">404</p>
        <h1 className="mt-4 text-base font-medium text-foreground">Page not found</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-5">
          <Button variant="ghost" nativeButton={false} render={<Link href="/" />} className={ACTION_PRIMARY}>
            Go home
          </Button>
        </div>
      </div>
    </main>
  )
}
