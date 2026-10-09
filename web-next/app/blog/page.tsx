import Link from 'next/link'
import { posts } from '@/lib/blog'

export const metadata = { title: 'Blog | CoachXYZ' }

export default function BlogPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-background text-foreground-strong antialiased">
      {/* themed banner */}
      <section className="border-b border-border bg-muted px-6 py-14 text-center lg:px-8">
        <p className="text-caption font-medium tracking-[0.08em] text-muted-foreground uppercase">
          Blog
        </p>
        <h1 className="mx-auto mt-3 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
          Read. Watch. Code.
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-balance text-[18px] leading-7 text-muted-foreground">
          Product updates, research notes and coaching playbooks.
        </p>
      </section>
      <section className="mx-auto max-w-[1120px] px-6 py-10 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group overflow-hidden rounded-[6px] border border-border bg-background transition-colors duration-[180ms] hover:border-border-hover hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <div className="flex h-40 items-center justify-center border-b border-border bg-muted">
                <span className="grid size-9 place-items-center rounded-[6px] bg-primary/10 text-meta font-bold text-link">
                  C
                </span>
              </div>
              <div className="p-5">
                <p className="text-label font-medium tracking-[0.06em] text-muted-foreground uppercase tabular-nums">
                  {p.tag} • {p.date}
                </p>
                <h2 className="mt-2 text-title font-semibold leading-snug group-hover:text-link group-hover:underline">
                  {p.title}
                </h2>
                <p className="mt-1.5 text-body leading-6 text-muted-foreground">{p.excerpt}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
