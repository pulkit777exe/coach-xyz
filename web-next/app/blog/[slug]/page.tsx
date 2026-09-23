import { notFound } from 'next/navigation'
import Link from 'next/link'
import { postsBySlug } from '@/lib/blog'

export function generateStaticParams() {
  return Object.keys(postsBySlug).map((slug) => ({ slug }))
}

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const p = postsBySlug[slug]
  if (!p) notFound()
  return (
    <main className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      {/* themed banner */}
      <div className="border-b border-[rgba(55,53,47,0.09)] bg-[#f7f7f5] px-6 py-12 text-center lg:px-8 dark:border-[rgba(255,255,255,0.08)] dark:bg-[#202020]">
        <Link
          href="/blog"
          className="inline-block rounded-[6px] text-sm text-[#787774] transition-colors duration-[120ms] hover:text-[#2383e2] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:text-[#9b9b9b] dark:hover:text-[#4da3ec]"
        >
          ← Back to blog
        </Link>
        <p className="mt-4 text-[11px] font-medium tracking-[0.06em] text-[#787774] uppercase dark:text-[#9b9b9b]">
          {p.tag}
        </p>
        <h1 className="mx-auto mt-2 max-w-[720px] text-balance text-[30px] font-bold leading-[1.15] tracking-[-0.02em] sm:text-[40px]">
          {p.title}
        </h1>
        <p className="mt-3 text-sm text-[#787774] tabular-nums dark:text-[#9b9b9b]">{p.date}</p>
      </div>
      <article className="mx-auto max-w-[720px] px-6 py-10 lg:px-8">
        <div className="space-y-5 text-[16px] leading-[1.6] text-[#37352f]/85 dark:text-[#ececec]/85">
          {p.body.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <div className="mt-10 border-t border-[rgba(55,53,47,0.09)] pt-6 dark:border-[rgba(255,255,255,0.08)]">
          <Link
            href="/blog"
            className="inline-block rounded-[6px] text-sm font-medium text-[#2383e2] transition-colors duration-[120ms] hover:text-[#1b6fb8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:text-[#4da3ec]"
          >
            ← All posts
          </Link>
        </div>
      </article>
    </main>
  )
}
