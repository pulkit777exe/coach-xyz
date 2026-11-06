// ── Security headers ────────────────────────────────────────────────────────
// Static headers live in next.config.ts. The Content-Security-Policy needs a
// per-request nonce so Next.js can tag its bootstrap scripts, so it is built
// here and applied by proxy.ts (the Next 16 middleware convention).

const isDev = process.env.NODE_ENV !== 'production'
const API_PROXY = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const SENTRY_CONNECT = [
  'https://*.sentry.io',
  'https://*.ingest.sentry.io',
  'https://*.ingest.us.sentry.io',
]

/**
 * Build the CSP for one request. `script-src` carries a nonce plus
 * `strict-dynamic`: Next.js adds the nonce to its own script tags, and any
 * script those trusted scripts load inherits trust. `'unsafe-inline'` is kept
 * only as a CSP2 fallback — CSP3 browsers ignore it whenever a nonce is
 * present, so injected inline scripts are still blocked.
 */
export function buildCsp(nonce: string, opts: { dev?: boolean } = {}): string {
  const dev = opts.dev ?? isDev
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'unsafe-inline'",
    'https://browser.sentry-cdn.com',
    'https://js.sentry-cdn.com',
  ]
  if (dev) scriptSrc.push("'unsafe-eval'")

  const connectSrc = ["'self'", ...SENTRY_CONNECT, 'https://*.auth0.com', API_PROXY]
  if (dev) connectSrc.push('http://localhost:*', 'ws://localhost:*')

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.auth0.com https://s.gravatar.com https://*.googleusercontent.com https://*.githubusercontent.com",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' mailto:",
    "manifest-src 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}
