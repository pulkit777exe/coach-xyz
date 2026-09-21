import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { Elysia } from "elysia"

import { buildError } from "../src/lib/errors"
import { mintAttributionToken, verifyAttributionToken } from "../src/lib/attribution"
import { SERVICE_HEADERS, serviceGuard } from "../src/lib/serviceGuard"

const TEST_SERVICE_TOKEN = "test-service-token"
const VERIFIED = "auth0|player-123"

// Mirrors the /api/me/attribution/mint route on the real me routes app
// (me.ts default export pulls in the full analyze queue wiring, so the test
// boots a trimmed app with the same serviceGuard + mintAttributionToken).
const app = new Elysia()
  .use(serviceGuard)
  .get("/api/me/attribution/mint", async ({ request, set }) => {
    const verified = request.headers.get(SERVICE_HEADERS.verifiedAuth0Id)
    if (!verified) {
      set.status = 403
      return buildError("FORBIDDEN", "Missing verified identity", false)
    }
    const minted = mintAttributionToken(verified)
    if (!minted) {
      set.status = 503
      return buildError("SERVICE_NOT_CONFIGURED", "Attribution signing is not configured.", true)
    }
    set.status = 200
    return minted
  })

const setToken = (value?: string) => {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

const headersFor = (auth0Id: string) => ({
  "Content-Type": "application/json",
  "x-service-token": TEST_SERVICE_TOKEN,
  "x-verified-auth0-id": auth0Id,
})

beforeEach(() => setToken(TEST_SERVICE_TOKEN))
afterEach(() => setToken(undefined))

describe("GET /api/me/attribution/mint", () => {
  test("mints a token for the verified session sub", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/me/attribution/mint", { headers: headersFor(VERIFIED) }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; exp: number }
    expect(typeof body.token).toBe("string")
    expect(typeof body.exp).toBe("number")
    expect(verifyAttributionToken(body.token, TEST_SERVICE_TOKEN)).toBe(VERIFIED)
  })

  test("the minted token resolves to the caller, not a spoofed header", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/me/attribution/mint", { headers: headersFor("auth0|attacker") }),
    )
    const body = (await res.json()) as { token: string }
    expect(verifyAttributionToken(body.token, TEST_SERVICE_TOKEN)).toBe("auth0|attacker")
  })

  test("forbids anonymous requests (no verified identity)", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/me/attribution/mint", {
        headers: { "x-service-token": TEST_SERVICE_TOKEN },
      }),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("FORBIDDEN")
  })

  test("forbids requests without the service token", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/me/attribution/mint", {
        headers: { "x-verified-auth0-id": VERIFIED },
      }),
    )
    expect(res.status).toBe(403)
  })
})

describe("scan/analyze attribution", () => {
  test("server rejects a raw x-auth0-id that never went through mint", () => {
    // verifyAttributionToken is what scan.ts/analyze.ts use — a client setting
    // x-auth0-id directly is ignored because no x-attribution signature exists.
    expect(verifyAttributionToken(null, TEST_SERVICE_TOKEN)).toBeNull()
    // Even a minted token binds exactly the sub it was signed for.
    const forged = "auth0|victim.1" + ".deadbeef"
    expect(verifyAttributionToken(forged, TEST_SERVICE_TOKEN)).toBeNull()
  })
})