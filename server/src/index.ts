import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"
import { betaAuth } from "./middleware/betaAuth"

// Start BullMQ worker as a side effect on import
import "./lib/queue"

import scanRoute from "./routes/scan"
import analyzeRoute from "./routes/analyze"
import statusRoute from "./routes/status"
import downloadRoute from "./routes/download"
import { healthRoute } from "./routes/health"
import { historyStoreEnabled, initializeHistoryStore } from "./lib/supabaseHistory"
import { buildError } from "./lib/errors"

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
  .use(cors({ origin: "*" }))
  .use(betaAuth)
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
  .get("/api/verify-code", () => ({ valid: true }))
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
