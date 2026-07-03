// IMPORTANT: Import instrument.ts first (before anything else)
import "./instrument"

import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"

// Start BullMQ worker as a side effect on import
import "./lib/queue"

import scanRoute from "./routes/scan"
import analyzeRoute from "./routes/analyze"
import statusRoute from "./routes/status"
import downloadRoute from "./routes/download"
import { healthRoute } from "./routes/health"
import { historyStoreEnabled, initializeHistoryStore } from "./lib/supabaseHistory"
import { buildError } from "./lib/errors"

// ── Validate Required Environment Variables ────────────────────────────────
const requiredEnvVars = ["ENGINE_URL"]
const missingEnvVars = requiredEnvVars.filter((k) => !process.env[k])
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`)
  process.exit(1)
}

// ── Beta Code Helpers ──────────────────────────────────────────────────────
function getValidBetaCodes(): string[] {
  return (process.env.BETA_CODES ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
}

function isValidBetaCode(code: string | null): boolean {
  if (!code) return false
  const validCodes = getValidBetaCodes()
  return validCodes.length === 0 || validCodes.includes(code.trim().toLowerCase())
}

const maxFileSizeBytes = Number(process.env.MAX_FILE_SIZE ?? 500 * 1024 * 1024)
const maxRequestBodySize = Number.isFinite(maxFileSizeBytes)
  ? Math.max(maxFileSizeBytes + 10 * 1024 * 1024, 64 * 1024 * 1024)
  : 600 * 1024 * 1024

await initializeHistoryStore()

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
  .onAfterHandle(({ set }) => {
    set.headers["X-Content-Type-Options"] = "nosniff"
    set.headers["X-Frame-Options"] = "DENY"
    set.headers["X-XSS-Protection"] = "1; mode=block"
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    set.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    set.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
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
  .get("/api/verify-code", ({ request }) => {
    const code = request.headers.get("x-beta-code")?.trim().toLowerCase() ?? null
    return { valid: isValidBetaCode(code) }
  })
  // ── Beta Code Middleware ────────────────────────────────────────────────
  // Reject requests with no/invalid beta code (except public endpoints)
  .onBeforeHandle(({ request, set }) => {
    const url = new URL(request.url)
    const publicPaths = ["/health", "/api/verify-code", "/swagger"]
    if (publicPaths.some((p) => url.pathname.startsWith(p))) return

    const code = request.headers.get("x-beta-code")?.trim().toLowerCase() ?? null
    if (!isValidBetaCode(code)) {
      set.status = 401
      return buildError("INVALID_BETA_CODE", undefined, false)
    }
  })
  .use(scanRoute)
  .use(analyzeRoute)
  .use(statusRoute)
  .use(downloadRoute)
  // ── Global Error Handler ─────────────────────────────────────────────────
  .onError(({ error, set, request }) => {
    const e = error as any
    // If it's already a CoachAIError shape, pass it through
    if (e?.code && e?.message && e?.layer) {
      set.status = e.retryable ? 422 : 500
      return e
    }
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
