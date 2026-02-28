import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { swagger } from "@elysiajs/swagger"

import scanRoute from "./routes/scan"
import analyzeRoute from "./routes/analyze"
import statusRoute from "./routes/status"
import downloadRoute from "./routes/download"

const app = new Elysia()
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
  .listen(Number(process.env.PORT) || 8000)

console.log(`CoachAI Server running on :${app.server?.port}`)
