import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"

import scanRoute from "./routes/scan"
import analyzeRoute from "./routes/analyze"
import statusRoute from "./routes/status"
import downloadRoute from "./routes/download"

const maxFileSizeBytes = Number(process.env.MAX_FILE_SIZE ?? 500 * 1024 * 1024)
const maxRequestBodySize = Number.isFinite(maxFileSizeBytes)
  ? Math.max(maxFileSizeBytes + 10 * 1024 * 1024, 64 * 1024 * 1024)
  : 600 * 1024 * 1024

const app = new Elysia({
  serve: {
    // Required for large multipart uploads; keep higher than route-level file cap.
    maxRequestBodySize,
  },
})
  .use(cors({ origin: "*" }))
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: {
          title: "CoachAI Middleware API",
          version: "1.0.0",
        },
      },
    }),
  )
  .get("/health", () => ({
    status: "ok",
    engine: process.env.ENGINE_URL,
    timestamp: new Date().toISOString(),
  }))
  .use(scanRoute)
  .use(analyzeRoute)
  .use(statusRoute)
  .use(downloadRoute)
  .listen({
    port: Number(process.env.PORT) || 8000,
    maxRequestBodySize,
  })

console.log(`CoachAI Server running on :${app.server?.port}`)
console.log(`CoachAI maxRequestBodySize: ${maxRequestBodySize} bytes`)
