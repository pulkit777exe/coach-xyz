import Link from 'next/link'
import { posts } from '@/lib/blog'

export const metadata = { title: 'Blog | CoachXYZ' }

export default function BlogPage() {
  return (
    <main id="main" tabIndex={-1} className="bg-white text-[#37352f] antialiased dark:bg-[#191919] dark:text-[#ececec]">
      {/* themed banner */}
      <section className="border-b border-[rgba(55,53,47,0.09)] bg-[#f7f7f5] px-6 py-14 text-center lg:px-8 dark:border-[rgba(255,255,255,0.08)] dark:bg-[#202020]">
        <p className="text-[12px] font-medium tracking-[0.08em] text-[#787774] uppercase dark:text-[#9b9b9b]">
          Blog
        </p>
        <h1 className="mx-auto mt-3 max-w-[720px] text-balance text-[36px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
          Read. Watch. Code.
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-balance text-[18px] leading-7 text-[#787774] dark:text-[#9b9b9b]">
          Product updates, research notes and coaching playbooks.
        </p>
      </section>
      <section className="mx-auto max-w-[1120px] px-6 py-10 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group overflow-hidden rounded-[6px] border border-[rgba(55,53,47,0.09)] bg-white transition-colors duration-[180ms] hover:border-[rgba(55,53,47,0.2)] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-[rgba(255,255,255,0.08)] dark:bg-[#191919] dark:hover:border-[rgba(255,255,255,0.18)] dark:hover:bg-[#1e1e1e]"
            >
              <div className="flex h-40 items-center justify-center border-b border-[rgba(55,53,47,0.09)] bg-[#f7f7f5] dark:border-[rgba(255,255,255,0.08)] dark:bg-[#202020]">
                <span className="grid size-9 place-items-center rounded-[6px] bg-[#2383e2]/10 text-[13px] font-bold text-[#2383e2] dark:text-[#4da3ec]">
                  C
                </span>
              </div>
              <div className="p-5">
                <p className="text-[11px] font-medium tracking-[0.06em] text-[#787774] uppercase tabular-nums dark:text-[#9b9b9b]">
                  {p.tag} • {p.date}
                </p>
                <h2 className="mt-2 text-[15px] font-semibold leading-snug group-hover:text-[#2383e2] group-hover:underline dark:group-hover:text-[#4da3ec]">
                  {p.title}
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-[#787774] dark:text-[#9b9b9b]">
                  {p.excerpt}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
