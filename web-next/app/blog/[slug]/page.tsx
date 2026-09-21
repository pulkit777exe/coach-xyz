import { notFound } from 'next/navigation'
import Link from 'next/link'
import { postsBySlug } from '@/lib/blog'

export function generateStaticParams(){ return Object.keys(postsBySlug).map(slug=>({slug})) }

export default async function Post({ params }: { params: Promise<{slug:string}> }){
  const { slug } = await params
  const p = postsBySlug[slug]
  if(!p) notFound()
  return (
    <main className="bg-[var(--marketing-light)] text-[var(--marketing-brown)]">
      <div className="bg-[var(--marketing-dark)] px-6 py-10 text-center">
        <Link href="/blog" className="text-sm text-[var(--marketing-beige)]/60 hover:text-[var(--marketing-beige)]">← Back to blog</Link>
        <h1 className="mx-auto mt-2 max-w-[720px] text-[26px] font-bold leading-tight text-[var(--marketing-beige)]">{p.title}</h1>
        <p className="mt-2 text-sm text-[var(--marketing-beige)]/60">{p.date}</p>
      </div>
      <article className="mx-auto max-w-[720px] px-6 py-8 lg:px-8">
        <div className="space-y-4 text-[15px] leading-7 text-[var(--marketing-brown)]/80">
          {p.body.map((para,i)=><p key={i}>{para}</p>)}
        </div>
      </article>
    </main>
  )
}