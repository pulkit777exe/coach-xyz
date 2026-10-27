FROM oven/bun:1-alpine AS base

WORKDIR /app

# Install dependencies using bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Next.js collects telemetry during build time. 
# We disable it here to avoid sending data to Vercel.
ENV NEXT_TELEMETRY_DISABLED=1

# Build the app
RUN bun run build

# Production server
EXPOSE 3000
CMD ["bun", "run", "start"]
