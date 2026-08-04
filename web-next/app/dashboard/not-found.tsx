import Link from 'next/link'

export default function DashboardNotFound() {
  return (
    <div className="p-8 lg:p-12 max-w-5xl">
      <div className="border border-(--cream-10) p-12 text-center">
        <p className="text-teal-500 text-6xl font-bold mb-4">404</p>
        <h1 className="text-(--fg) text-xl font-semibold mb-4">Page not found</h1>
        <p className="text-(--cream-40) mb-8">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-6 py-3 border border-(--cream-10) text-(--fg) text-[0.65rem] uppercase tracking-[0.2em] transition-all hover:bg-(--fg) hover:text-(--bg)"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
