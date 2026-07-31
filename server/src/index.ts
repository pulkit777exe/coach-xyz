import "./instrument"

import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"

import "./lib/queue"

import scanRoute from "./routes/scan"
import analyzeRoute from "./routes/analyze"
import statusRoute from "./routes/status"
import downloadRoute from "./routes/download"
import chatRoute from "./routes/chat"
import { healthRoute } from "./routes/health"
import { historyStoreEnabled, initializeHistoryStore } from "./lib/supabaseHistory"
import { buildError, isCoachAIError } from "./lib/errors"
import { MAX_FILE_SIZE_BYTES } from "./types"

// ── Global Crash Prevention ─────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({
    type: "unhandled_rejection",
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString(),
  }))
})

process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({
    type: "uncaught_exception",
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  }))
  // Give in-flight requests time to drain, then exit
  setTimeout(() => process.exit(1), 1000)
})

// ── Validate Required Environment Variables ────────────────────────────────
const requiredEnvVars = ["ENGINE_URL"]
const missingEnvVars = requiredEnvVars.filter((k) => !process.env[k])
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`)
  process.exit(1)
}

const maxRequestBodySize = Math.max(MAX_FILE_SIZE_BYTES + 10 * 1024 * 1024, 64 * 1024 * 1024)

try {
  await initializeHistoryStore()
} catch (err) {
  console.error(JSON.stringify({
    type: "history_store_init_failed",
    error: err instanceof Error ? err.message : "unknown",
    timestamp: new Date().toISOString(),
  }))
  // Continue — history is non-critical
}

const app = new Elysia({
  serve: {
    // Required for large multipart uploads; keep higher than route-level file cap.
    maxRequestBodySize,
  },
})
  .use(cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }))
  // ── Security Headers ───────────────────────────────────────────────────
  .onAfterHandle(({ set, request }) => {
    set.headers["X-Content-Type-Options"] = "nosniff"
    set.headers["X-Frame-Options"] = "DENY"
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    set.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    // Only set HSTS over HTTPS to avoid pinning localhost during development
    const isHttps = request.url.startsWith("https")
    if (isHttps) {
      set.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    }

    const isDev = process.env.NODE_ENV !== "production"
    set.headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://browser.sentry-cdn.com https://js.sentry-cdn.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      `connect-src 'self' https://*.sentry.io https://*.upstash.io${isDev ? " http://localhost:*" : ""}`,
      "worker-src 'self' blob:",
    ].join("; ")
  })
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: {
          title: "CoachAI Middleware API",
          version: "2.0.0",
        },
      },
    }),
  )
  .use(healthRoute)
  .use(scanRoute)
  .use(analyzeRoute)
  .use(statusRoute)
  .use(downloadRoute)
  .use(chatRoute)

  // ── Global Error Handler ─────────────────────────────────────────────────
  .onError(({ error, set, request }) => {
    // If it's already a CoachAIError shape, pass it through
    if (isCoachAIError(error)) {
      set.status = error.retryable ? 503 : 500
      return error
    }
    const e = error as { message?: string; stack?: string }
    console.error(
      JSON.stringify({
        type: "unhandled_error",
        message: e?.message,
        stack: e?.stack,
        path: new URL(request.url).pathname,
        timestamp: new Date().toISOString(),
      }),
    )
    set.status = 500
    return buildError("INTERNAL_ERROR", undefined, true)
  })
  .listen({
    port: Number(process.env.PORT) || 8000,
    maxRequestBodySize,
  })

console.log(`CoachAI Server running on :${app.server?.port}`)
console.log(`CoachAI maxRequestBodySize: ${maxRequestBodySize} bytes`)
console.log(
  `CoachAI Supabase history store: ${historyStoreEnabled() ? "enabled" : "disabled"}`,
)
console.log(`CoachAI BullMQ worker started`)
