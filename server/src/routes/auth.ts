import { Elysia } from "elysia"
import {
  upsertUser,
  getUserByAuth0Id,
  getUserAnalyses,
  getUserAnalysisById,
  getUserStats,
} from "../lib/supabaseHistory"

export default new Elysia()
  .post("/api/auth/sync", async ({ body, set }) => {
    const { sub, email, name, nickname, picture, email_verified } = body as {
      sub: string
      email?: string
      name?: string
      nickname?: string
      picture?: string
      email_verified?: boolean
    }

    if (!sub) {
      set.status = 400
      return { error: "Missing required field: sub" }
    }

    const user = await upsertUser({
      sub,
      email,
      name,
      nickname,
      picture,
      email_verified,
    })

    if (!user) {
      set.status = 500
      return { error: "Failed to sync user" }
    }

    set.status = 200
    return { user }
  })
  .get("/api/auth/user/:auth0Id", async ({ params, set }) => {
    const { auth0Id } = params

    if (!auth0Id) {
      set.status = 400
      return { error: "Missing auth0Id parameter" }
    }

    const user = await getUserByAuth0Id(auth0Id)

    if (!user) {
      set.status = 404
      return { error: "User not found" }
    }

    set.status = 200
    return { user }
  })
  .get("/api/auth/user/:auth0Id/analyses", async ({ params, request, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return { error: "Missing auth0Id parameter" }
    }

    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100)
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0)

    const analyses = await getUserAnalyses(auth0Id, limit, offset)
    set.status = 200
    return { analyses }
  })
  .get("/api/auth/user/:auth0Id/analyses/:jobId", async ({ params, set }) => {
    const { auth0Id, jobId } = params
    if (!auth0Id || !jobId) {
      set.status = 400
      return { error: "Missing required parameters" }
    }

    const analysis = await getUserAnalysisById(auth0Id, jobId)
    if (!analysis) {
      set.status = 404
      return { error: "Analysis not found" }
    }

    set.status = 200
    return { analysis }
  })
  .get("/api/auth/user/:auth0Id/stats", async ({ params, set }) => {
    const { auth0Id } = params
    if (!auth0Id) {
      set.status = 400
      return { error: "Missing auth0Id parameter" }
    }

    const stats = await getUserStats(auth0Id)
    set.status = 200
    return { stats }
  })
