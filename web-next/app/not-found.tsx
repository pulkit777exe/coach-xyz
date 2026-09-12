import Link from "next/link"
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-(--bg) flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <p className="text-teal-500 text-6xl font-bold mb-4">404</p>
        <h1 className="text-(--fg) text-xl font-semibold mb-4">Page not found</h1>
        <p className="text-(--cream-40) mb-8">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link href="/">
          <Button size="lg">
            Go home
          </Button>
        </Link>
      </div>
    </div>
  )
}
