import type { Metadata } from 'next'
import Link from 'next/link'
import { Compass } from 'lucide-react'
import { Button } from '@/components/9ui/ui/button'

export const metadata: Metadata = { title: 'Page not found | CoachXYZ' }

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-foreground">
          <Compass className="size-6" />
        </div>
        <h1 className="mt-4 text-5xl font-bold tracking-tight text-foreground">404</h1>
        <p className="mt-2 text-base font-semibold text-foreground">Page not found</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Button size="lg" render={<Link href="/" />}>Go home</Button>
        </div>
      </div>
    </main>
  )
}