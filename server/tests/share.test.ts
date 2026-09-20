import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { Elysia } from "elysia"
import {
  createShareTokenStore,
  generateShareToken,
  DEFAULT_EXPIRES_HOURS,
  type RedisLike,
  type ShareTokenRecord,
} from "../src/lib/shareTokens"
import { orgShareRoute, publicShareRoute } from "../src/routes/share"
import type { DashboardAnalysis } from "../src/lib/supabaseHistory"

const TEST_SERVICE_TOKEN = "test-service-token"
const headersFor = (auth0Id: string) => ({
  "x-service-token": TEST_SERVICE_TOKEN,
  "x-verified-auth0-id": auth0Id,
})

// ── In-memory Redis-like client ─────────────────────────────────────────────

function memoryClient(seed: Record<string, ShareTokenRecord> = {}): RedisLike & { map: Map<string, ShareTokenRecord> } {
  const map = new Map<string, ShareTokenRecord>(Object.entries(seed))
  return {
    map,
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value as ShareTokenRecord)
    },
    async del(key) {
      map.delete(key)
      return 1
    },
  }
}

const FAKE_ANALYSIS: DashboardAnalysis = {
  server_job_id: "job-1",
  auth0_id: "auth-coach-1",
  engine_job_id: "eng-1",
  session_token: null,
  player_index: null,
  model: "gemini-2.5-flash",
  stage: 6,
  stage_name: "Complete",
  progress: 100,
  complete: true,
  video_ready: true,
  summary_json: { form_score: 7.5, form_score_trend: "improving", top_tips: ["keep head up"] },
  error_code: null,
  error_message: null,
  requested_at: "2026-09-01T10:00:00.000Z",
  completed_at: "2026-09-01T10:05:00.000Z",
  download_count: 0,
  display_name: "Serve practice",
  requested_by: null,
  file_name: null,
  file_size_bytes: null,
  player_count: 1,
  student_id: "s1",
}

// ── Store unit tests ─────────────────────────────────────────────────────────

describe("share token store", () => {
  test("generateShareToken returns a long hex token", () => {
    const token = generateShareToken()
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    expect(token).not.toBe(generateShareToken())
  })

  test("createShareToken round-trips and sets a TTL", async () => {
    const client = memoryClient()
    const store = createShareTokenStore(client)
    const created = await store.createShareToken({ auth0_id: "auth-coach-1", server_job_id: "job-1" })
    expect(created.token).toMatch(/^[0-9a-f]{48}$/)
    expect(created.auth0_id).toBe("auth-coach-1")
    expect(created.server_job_id).toBe("job-1")

    const read = await store.getShareToken(created.token)
    expect(read).not.toBeNull()
    expect(read!.auth0_id).toBe("auth-coach-1")
  })

  test("createShareToken honours custom expiry", async () => {
    const store = createShareTokenStore(memoryClient())
    const created = await store.createShareToken({
      auth0_id: "a",
      server_job_id: "j",
      expiresInHours: 1,
    })
    const spanMs = Date.parse(created.expires_at) - Date.parse(created.created_at)
    expect(spanMs).toBe(60 * 60 * 1000)
    expect(spanMs).not.toBe(DEFAULT_EXPIRES_HOURS * 60 * 60 * 1000)
  })

  test("resolveShareToken returns null for expired tokens", async () => {
    const client = memoryClient({
      "coachai:share:expired": {
        auth0_id: "a",
        server_job_id: "j",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-01-02T00:00:00.000Z",
      },
    })
    const store = createShareTokenStore(client)
    expect(await store.resolveShareToken("expired")).toBeNull()
    // getShareToken still returns the raw record so routes can 410 vs 404.
    expect(await store.getShareToken("expired")).not.toBeNull()
  })

  test("resolveShareToken returns the record while valid", async () => {
    const client = memoryClient({
      "coachai:share:valid": {
        auth0_id: "a",
        server_job_id: "j",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    })
    const store = createShareTokenStore(client)
    expect(await store.resolveShareToken("valid")).not.toBeNull()
    expect(await store.resolveShareToken("nope")).toBeNull()
  })
})

// ── Org (guarded) route tests ────────────────────────────────────────────────

describe("POST /api/org/:auth0Id/analyses/:jobId/share-token", () => {
  beforeEach(() => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
  })
  afterEach(() => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
  })

  test("mints a token when the analysis exists", async () => {
    const client = memoryClient()
    const store = createShareTokenStore(client)
    const app = new Elysia().use(orgShareRoute({ store, getAnalysis: async () => FAKE_ANALYSIS }))

    const res = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/analyses/job-1/share-token", {
        method: "POST",
        headers: headersFor("auth-coach-1"),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.token).toBe("string")
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(body.url).toBe(`/share/${body.token}`)
    expect(client.map.size).toBe(1)
  })

  test("404s when the analysis does not exist", async () => {
    const app = new Elysia().use(orgShareRoute({ store: createShareTokenStore(memoryClient()), getAnalysis: async () => null }))
    const res = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/analyses/ghost/share-token", {
        method: "POST",
        headers: headersFor("auth-coach-1"),
      }),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("NOT_FOUND")
  })

  test("403s when the analysis belongs to a different account", async () => {
    const foreign = { ...FAKE_ANALYSIS, auth0_id: "auth-victim" }
    const app = new Elysia().use(
      orgShareRoute({ store: createShareTokenStore(memoryClient()), getAnalysis: async () => foreign }),
    )
    const res = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/analyses/job-1/share-token", {
        method: "POST",
        headers: headersFor("auth-coach-1"),
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("FORBIDDEN")
  })

  test("DELETE revokes an owned token and 403s for foreign tokens", async () => {
    const store = createShareTokenStore(memoryClient())
    const { token } = await store.createShareToken({ auth0_id: "auth-coach-1", server_job_id: "job-1" })
    const app = new Elysia().use(orgShareRoute({ store, getAnalysis: async () => FAKE_ANALYSIS }))

    const ok = await app.handle(
      new Request(`http://localhost/api/org/auth-coach-1/share-tokens/${token}`, {
        method: "DELETE",
        headers: headersFor("auth-coach-1"),
      }),
    )
    expect(ok.status).toBe(200)
    expect(await store.getShareToken(token)).toBeNull()

    const { token: other } = await store.createShareToken({ auth0_id: "auth-victim", server_job_id: "job-2" })
    const foreign = await app.handle(
      new Request(`http://localhost/api/org/auth-coach-1/share-tokens/${other}`, {
        method: "DELETE",
        headers: headersFor("auth-coach-1"),
      }),
    )
    expect(foreign.status).toBe(403)
    expect(await store.getShareToken(other)).not.toBeNull()
  })

  test("DELETE 404s for an unknown token", async () => {
    const app = new Elysia().use(
      orgShareRoute({ store: createShareTokenStore(memoryClient()), getAnalysis: async () => FAKE_ANALYSIS }),
    )
    const res = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/share-tokens/nope", {
        method: "DELETE",
        headers: headersFor("auth-coach-1"),
      }),
    )
    expect(res.status).toBe(404)
  })

  test("enforces service identity: wrong or missing headers are rejected", async () => {
    const app = new Elysia().use(orgShareRoute({ store: createShareTokenStore(memoryClient()), getAnalysis: async () => FAKE_ANALYSIS }))

    // Missing service headers → 403
    const noHeaders = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/analyses/job-1/share-token", {
        method: "POST",
      }),
    )
    expect(noHeaders.status).toBe(403)
    expect((await noHeaders.json()).code).toBe("FORBIDDEN")

    // Mismatched verified id → 403
    const mismatch = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/analyses/job-1/share-token", {
        method: "POST",
        headers: headersFor("auth-someone-else"),
      }),
    )
    expect(mismatch.status).toBe(403)
  })

  test("serviceGuard is inert for org routes when SERVICE_TOKEN is unset", async () => {
    delete process.env.SERVICE_TOKEN
    const app = new Elysia().use(orgShareRoute({ store: createShareTokenStore(memoryClient()), getAnalysis: async () => FAKE_ANALYSIS }))
    const res = await app.handle(
      new Request("http://localhost/api/org/auth-coach-1/analyses/job-1/share-token", {
        method: "POST",
      }),
    )
    expect(res.status).toBe(201)
  })
})

// ── Public (unguarded) route tests ───────────────────────────────────────────

describe("GET /api/share/:token", () => {
  test("returns analysis data for a valid token", async () => {
    const store = createShareTokenStore(memoryClient())
    const { token } = await store.createShareToken({ auth0_id: "auth-coach-1", server_job_id: "job-1" })
    const app = new Elysia().use(publicShareRoute({ store, getAnalysis: async () => FAKE_ANALYSIS }))

    const res = await app.handle(new Request(`http://localhost/api/share/${token}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.server_job_id).toBe("job-1")
    expect(body.auth0_id).toBeUndefined()
    expect(body.analysis.display_name).toBe("Serve practice")
    expect(body.analysis.summary_json.form_score).toBe(7.5)
    expect(body.analysis.video_ready).toBe(true)
  })

  test("404s for an unknown token", async () => {
    const app = new Elysia().use(publicShareRoute({ store: createShareTokenStore(memoryClient()), getAnalysis: async () => null }))
    const res = await app.handle(new Request("http://localhost/api/share/does-not-exist"))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("NOT_FOUND")
  })

  test("410s for an expired token", async () => {
    const store = createShareTokenStore(
      memoryClient({
        "coachai:share:expired-route": {
          auth0_id: "auth-coach-1",
          server_job_id: "job-1",
          created_at: "2026-01-01T00:00:00.000Z",
          expires_at: "2026-01-02T00:00:00.000Z",
        },
      }),
    )
    const app = new Elysia().use(publicShareRoute({ store, getAnalysis: async () => FAKE_ANALYSIS }))
    const res = await app.handle(new Request("http://localhost/api/share/expired-route"))
    expect(res.status).toBe(410)
    expect((await res.json()).code).toBe("SHARE_EXPIRED")
  })

  test("404s when the underlying analysis is gone", async () => {
    const store = createShareTokenStore(memoryClient())
    const { token } = await store.createShareToken({ auth0_id: "auth-coach-1", server_job_id: "job-1" })
    const app = new Elysia().use(publicShareRoute({ store, getAnalysis: async () => null }))
    const res = await app.handle(new Request(`http://localhost/api/share/${token}`))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("NOT_FOUND")
  })

  test("never requires service headers", async () => {
    process.env.SERVICE_TOKEN = TEST_SERVICE_TOKEN
    const store = createShareTokenStore(memoryClient())
    const { token } = await store.createShareToken({ auth0_id: "auth-coach-1", server_job_id: "job-1" })
    const app = new Elysia().use(publicShareRoute({ store, getAnalysis: async () => FAKE_ANALYSIS }))
    const res = await app.handle(new Request(`http://localhost/api/share/${token}`))
    expect(res.status).toBe(200)
    delete process.env.SERVICE_TOKEN
  })
})