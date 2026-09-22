import Link from 'next/link'
import { posts } from '@/lib/blog'

export const metadata = { title: 'Blog | CoachXYZ' }

export default function BlogPage() {
  return (
    <main className="bg-[var(--marketing-light)] text-[var(--marketing-brown)]">
      <section className="bg-[var(--marketing-dark)] px-6 py-10 text-center lg:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Blog</p>
        <h1 className="mt-2 text-[32px] font-bold tracking-tight text-[var(--marketing-beige)]">
          Read. Watch. Code.
        </h1>
        <p className="mx-auto mt-2 max-w-[560px] text-sm text-[var(--marketing-beige)]/60">
          Product updates, research notes and coaching playbooks.
        </p>
      </section>
      <section className="mx-auto max-w-[1120px] px-6 py-8 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group overflow-hidden rounded-2xl border border-[var(--marketing-beige)] bg-[var(--marketing-white)] hover:border-[var(--marketing-brown)]/20"
            >
              <div className="h-40 bg-gradient-to-br from-[var(--marketing-lime)]/30 via-success/10 to-[var(--marketing-beige)]/30" />
              <div className="p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-success">
                  {p.tag} • {p.date}
                </p>
                <h3 className="mt-2 text-sm font-semibold leading-tight group-hover:underline">
                  {p.title}
                </h3>
                <p className="mt-1 text-sm leading-6 text-[var(--marketing-brown)]/60">
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
