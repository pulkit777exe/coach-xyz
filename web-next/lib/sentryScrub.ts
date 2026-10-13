// ── Sentry URL scrubbing ─────────────────────────────────────────────────────
// Bearer credentials travel in URLs by design (signed ?attribution= download
// links, single-use invite/share tokens). Breadcrumbs, transactions, and
// request URLs would otherwise ship them to the Sentry project, where anyone
// with project access could replay a fresh token. Strip every query string
// and fragment before the event leaves the browser/server.

import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'

/** Drop the query string and fragment; keep origin + path for grouping. */
export function scrubUrl(value: string): string {
  const query = value.indexOf('?')
  const fragment = value.indexOf('#')
  const cuts = [query, fragment].filter((i) => i >= 0)
  return cuts.length === 0 ? value : value.slice(0, Math.min(...cuts))
}

const scrubBreadcrumb = (crumb: Breadcrumb): Breadcrumb => {
  const data = crumb.data as Record<string, unknown> | undefined
  const url = data?.url
  if (typeof url === 'string') {
    return { ...crumb, data: { ...data, url: scrubUrl(url) } }
  }
  if (typeof crumb.message === 'string' && /^https?:\/\//.test(crumb.message)) {
    return { ...crumb, message: scrubUrl(crumb.message) }
  }
  return crumb
}

/** beforeSend hook: scrub request URL, breadcrumb URLs, and transaction names. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event }
  if (typeof scrubbed.request?.url === 'string') {
    scrubbed.request = { ...scrubbed.request, url: scrubUrl(scrubbed.request.url) }
  }
  if (Array.isArray(scrubbed.breadcrumbs)) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(scrubBreadcrumb)
  }
  if (typeof scrubbed.transaction === 'string') {
    scrubbed.transaction = scrubUrl(scrubbed.transaction)
  }
  return scrubbed
}

/** beforeBreadcrumb hook: scrub navigation/fetch URLs at capture time. */
export function scrubSentryBreadcrumb(
  crumb: Breadcrumb,
): Breadcrumb | null {
  return scrubBreadcrumb(crumb)
}
