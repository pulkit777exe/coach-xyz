import Link from 'next/link'
import { Compass } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export default function DashboardNotFound() {
  return (
    <div className="p-8 lg:p-12">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-10 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-foreground">
          <Compass className="size-6" />
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground">404</h1>
        <p className="mt-2 text-sm font-semibold text-foreground">Page not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Button render={<Link href="/dashboard" />}>Back to dashboard</Button>
        </div>
      </div>
    </div>
  )
}
