import { notFound } from 'next/navigation'
import Link from 'next/link'
import { postsBySlug } from '@/lib/blog'

export function generateStaticParams() {
  return Array.from(postsBySlug.keys()).map((slug) => ({ slug }))
}

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const p = postsBySlug.get(slug)
  if (!p) notFound()
  return (
    <main id="main" tabIndex={-1} className="bg-background text-foreground-strong antialiased">
      {/* themed banner */}
      <div className="border-b border-border bg-muted px-6 py-12 text-center lg:px-8">
        <Link
          href="/blog"
          className="inline-block rounded-[6px] text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          ← Back to blog
        </Link>
        <p className="mt-4 text-label font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {p.tag}
        </p>
        <h1 className="mx-auto mt-2 max-w-[720px] text-balance text-[30px] font-bold leading-[1.15] tracking-[-0.02em] sm:text-[40px]">
          {p.title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground tabular-nums">{p.date}</p>
      </div>
      <article className="mx-auto max-w-[720px] px-6 py-10 lg:px-8">
        <div className="space-y-5 text-lead leading-[1.6] text-foreground-strong/85">
          {p.body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <div className="mt-10 border-t border-border pt-6">
          <Link
            href="/blog"
            className="inline-block rounded-[6px] text-sm font-medium text-link transition-colors duration-[120ms] hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            ← All posts
          </Link>
        </div>
      </article>
    </main>
  )
}
