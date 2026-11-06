# Multi-stage build on the Node version CI uses (npm + package-lock.json are
# the source of truth for web-next). The previous bun-based image ran as root
# and used a stale bun.lock, so `--frozen-lockfile` could not match
# package.json. Runtime is the Next standalone server under an unprivileged
# user, with only the traced production dependencies copied in.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder
WORKDIR /app
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they must be build args, not runtime env.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1 \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next standalone expects a public/ directory even when the app has none.
RUN mkdir -p public && npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SENTRY_RUNTIME_CHANNEL_INJECTION=0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
