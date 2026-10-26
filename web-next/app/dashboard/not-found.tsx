import Link from 'next/link'
import { Button } from '@/components/9ui/ui/button'

const ACTION_PRIMARY =
  'h-auto! px-1 text-body leading-5 font-medium text-primary! transition-colors hover:bg-transparent! hover:text-primary/80!'

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-background p-8 lg:p-12">
      <div className="w-full max-w-sm rounded-[8px] border border-border bg-card p-8 text-center">
        <p className="text-[40px] leading-none font-bold text-muted-foreground">404</p>
        <h1 className="mt-4 text-lead leading-6 font-medium text-foreground">Page not found</h1>
        <p className="mt-1.5 text-body leading-5 text-muted-foreground">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-5">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/dashboard" />}
            className={ACTION_PRIMARY}
          >
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
