// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs'

import { scrubSentryBreadcrumb, scrubSentryEvent } from './lib/sentryScrub'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Bearer tokens travel in URLs by design (?attribution=, invite/share
  // tokens) — strip query strings before events leave the server.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeBreadcrumb: (crumb) => scrubSentryBreadcrumb(crumb),

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Standalone Docker builds do not trace Sentry's ESM diagnostics-channel
  // hook, so it warns on boot. Error capture still works; disable the hook
  // there and keep it on Vercel/dev where the hook is traced.
  enableRuntimeChannelInjection: process.env.SENTRY_RUNTIME_CHANNEL_INJECTION !== '0',


  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
})
