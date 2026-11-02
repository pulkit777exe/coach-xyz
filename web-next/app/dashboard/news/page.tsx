import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { unstable_noStore as noStore } from 'next/cache'
import { ArrowUpRight, Newspaper } from 'lucide-react'

import { getSession } from '@/lib/session'
import {
  NEWS_SPORT_LABEL,
  NEWS_SPORTS,
  fetchNews,
  formatNewsTime,
  normalizeNewsSport,
  type NewsArticle,
  type NewsSport,
} from '@/lib/news'

export const metadata: Metadata = {
  title: 'Newsroom | CoachXYZ',
  description: 'Sport headlines with a coach-generated training angle for each story.',
}

function sportHref(sport: NewsSport): string {
  return sport === 'all' ? '/dashboard/news' : `/dashboard/news?sport=${sport}`
}

function CoachAngle({ article }: { article: NewsArticle }) {
  return (
    <div className="mt-3 rounded-[6px] border border-border bg-background px-3 py-2">
      <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Coach&apos;s angle · from the headline
      </p>
      <p className="mt-1 text-body leading-[1.55] text-foreground">{article.coachAngle}</p>
    </div>
  )
}

function StoryImage({ article, hero = false }: { article: NewsArticle; hero?: boolean }) {
  if (!article.imageUrl) {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[16/9] w-full items-center justify-center rounded-[6px] bg-accent"
      >
        <Newspaper className="size-8 text-muted-foreground" />
      </div>
    )
  }
  return (
    // Remote feed images are already public CDN URLs; next/image would need a
    // remotePatterns entry per publisher and cannot optimise every feed rewrite.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={article.imageUrl}
      alt=""
      loading={hero ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      className="aspect-[16/9] w-full rounded-[6px] border border-border object-cover"
    />
  )
}

function SourceLine({ article }: { article: NewsArticle }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
      <span className="font-medium text-foreground">{article.source}</span>
      <span aria-hidden="true">·</span>
      <span>{formatNewsTime(article.publishedAt)}</span>
      <span aria-hidden="true">·</span>
      <span className="capitalize">{NEWS_SPORT_LABEL[article.sport]}</span>
    </p>
  )
}

function StoryLink({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-start gap-1 text-body font-medium text-foreground hover:text-primary"
    >
      <span>{article.title}</span>
      <ArrowUpRight
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
      />
    </a>
  )
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>
}) {
  noStore()
  const [session, params] = await Promise.all([getSession(), searchParams])
  if (!session) redirect('/auth/login')

  const sport = normalizeNewsSport(params.sport)
  const { articles, failures } = await fetchNews(sport)
  const [hero, ...rest] = articles

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6 lg:px-8">
      <header className="border-b border-border pb-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[6px] border border-border bg-card">
            <Newspaper aria-hidden="true" className="size-4 text-muted-foreground" />
          </span>
          <div>
            <h1 className="text-title font-semibold tracking-[-0.02em] text-foreground">
              Newsroom
            </h1>
            <p className="mt-1 max-w-2xl text-body text-muted-foreground">
              Sport headlines from public RSS feeds, each with a training angle generated from the
              headline. Links open the publisher&apos;s story.
            </p>
          </div>
        </div>

        <nav aria-label="News sport" className="mt-4 flex flex-wrap gap-1.5">
          {NEWS_SPORTS.map((item) => {
            const active = item === sport
            return (
              <Link
                key={item}
                href={sportHref(item)}
                aria-current={active ? 'page' : undefined}
                className={`rounded-[4px] border px-2.5 py-1 text-meta font-medium transition-colors ${
                  active
                    ? 'border-foreground/20 bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {NEWS_SPORT_LABEL[item]}
              </Link>
            )
          })}
        </nav>
      </header>

      {!hero && (
        <div className="mt-6 rounded-[6px] border border-border bg-card p-8 text-center">
          <p className="text-body font-medium text-foreground">No stories came back.</p>
          <p className="mt-1 text-meta text-muted-foreground">
            The public feeds may be rate-limiting or temporarily unavailable. Try another sport tab
            or come back in a few minutes.
          </p>
        </div>
      )}

      {hero && (
        <article className="mt-6 grid gap-5 rounded-[6px] border border-border bg-card p-5 md:grid-cols-2 md:p-6">
          <StoryImage article={hero} hero />
          <div className="min-w-0">
            <p className="text-label font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Lead story
            </p>
            <h2 className="mt-2 text-lead font-semibold leading-[1.35] tracking-[-0.01em] text-foreground">
              <StoryLink article={hero} />
            </h2>
            <div className="mt-2">
              <SourceLine article={hero} />
            </div>
            {hero.description && (
              <p className="mt-3 text-body leading-[1.6] text-muted-foreground">
                {hero.description}
              </p>
            )}
            <CoachAngle article={hero} />
          </div>
        </article>
      )}

      {rest.length > 0 && (
        <section aria-labelledby="latest-stories" className="mt-8">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2
                id="latest-stories"
                className="text-lead font-semibold tracking-[-0.01em] text-foreground"
              >
                Latest stories
              </h2>
              <p className="mt-0.5 text-meta text-muted-foreground">
                {rest.length} more from {NEWS_SPORT_LABEL[sport].toLowerCase()}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rest.map((article) => (
              <article
                key={article.id}
                className="flex flex-col rounded-[6px] border border-border bg-card p-4"
              >
                <StoryImage article={article} />
                <div className="mt-3 flex flex-1 flex-col">
                  <h3 className="text-body font-semibold leading-[1.45] text-foreground">
                    <StoryLink article={article} />
                  </h3>
                  <div className="mt-1.5">
                    <SourceLine article={article} />
                  </div>
                  {article.description && (
                    <p className="mt-2 line-clamp-3 text-meta leading-[1.55] text-muted-foreground">
                      {article.description}
                    </p>
                  )}
                  <div className="mt-auto">
                    <CoachAngle article={article} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {failures.length > 0 && (
        <p className="mt-6 rounded-[6px] border border-border bg-card px-4 py-3 text-meta text-muted-foreground">
          Some sources did not respond:{' '}
          {failures.map((failure) => `${failure.source} (${failure.message})`).join(', ')}. The
          stories that did load are shown above.
        </p>
      )}

      <footer className="mt-8 border-t border-border pt-4 text-label leading-[1.55] text-muted-foreground">
        Headlines, summaries and images belong to the publishers and open on their sites. Coach&apos;s
        angle is generated locally from the headline only — it is a training prompt, not a summary
        of the article.
      </footer>
    </div>
  )
}
