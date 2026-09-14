import { afterEach, describe, expect, test } from "bun:test"
import { SERVICE_HEADERS, verifyServiceIdentity } from "../src/lib/serviceGuard"

const TOKEN = "test-service-token"
const SUB = "auth0|user-123"

function setToken(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN
  } else {
    process.env.SERVICE_TOKEN = value
  }
}

afterEach(() => {
  setToken(undefined)
})

describe("verifyServiceIdentity", () => {
  test("allows requests when the guard is disabled (no SERVICE_TOKEN)", () => {
    expect(verifyServiceIdentity(null, null, "auth0|someone")).toEqual({ ok: true })
  })

  test("rejects missing service token when enabled", () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(null, SUB, SUB)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
    expect(outcome.body.code).toBe("FORBIDDEN")
  })

  test("rejects a wrong service token when enabled", () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity("wrong-token", SUB, SUB)
    expect(outcome.ok).toBe(false)
  })

  test("rejects a missing verified id", () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, null, SUB)
    expect(outcome.ok).toBe(false)
  })

  test("rejects a verified id that does not match the resource owner", () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, "auth0|other-user", SUB)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.body.code).toBe("FORBIDDEN")
  })

  test("rejects when the resource owner is unknown", () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, SUB, undefined)
    expect(outcome.ok).toBe(false)
  })

  test("allows a matching verified identity when enabled", () => {
    setToken(TOKEN)
    expect(verifyServiceIdentity(TOKEN, SUB, SUB)).toEqual({ ok: true })
  })

  test("allows self-scoped routes with only the verified identity", () => {
    setToken(TOKEN)
    expect(verifyServiceIdentity(TOKEN, SUB, undefined, { self: true })).toEqual({
      ok: true,
    })
  })

  test("rejects self-scoped routes without a verified identity", () => {
    setToken(TOKEN)
    const outcome = verifyServiceIdentity(TOKEN, null, undefined, { self: true })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.status).toBe(403)
  })

  test("reads the expected header names", () => {
    expect(SERVICE_HEADERS.token).toBe("x-service-token")
    expect(SERVICE_HEADERS.verifiedAuth0Id).toBe("x-verified-auth0-id")
  })
})