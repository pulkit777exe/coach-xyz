import { describe, expect, test } from "vitest"
import {
  decodePathSegment,
  isIdentityPath,
  isSelfPath,
  resourceAuth0Id,
} from "../serviceProxy"

describe("resourceAuth0Id", () => {
  test("extracts auth0Id from org routes", () => {
    expect(resourceAuth0Id(["api", "org", "auth0|123", "students"])).toBe("auth0|123")
    expect(resourceAuth0Id(["api", "org", "auth0|123"])).toBe("auth0|123")
  })

  test("extracts auth0Id from auth user routes", () => {
    expect(resourceAuth0Id(["api", "auth", "user", "auth0|123", "analyses"])).toBe("auth0|123")
    expect(resourceAuth0Id(["api", "auth", "user", "auth0|123", "analyses", "job-1", "chat"])).toBe(
      "auth0|123",
    )
  })

  test("returns undefined for non identity-bearing paths", () => {
    expect(resourceAuth0Id(["api", "auth", "sync"])).toBeUndefined()
    expect(resourceAuth0Id(["api", "scan-video"])).toBeUndefined()
    expect(resourceAuth0Id([])).toBeUndefined()
    expect(resourceAuth0Id(["api"])).toBeUndefined()
  })
})

describe("isIdentityPath", () => {
  test("accepts org and auth user routes", () => {
    expect(isIdentityPath(["api", "org", "auth0|1", "students"])).toBe(true)
    expect(isIdentityPath(["api", "auth", "user", "auth0|1", "stats"])).toBe(true)
  })

  test("accepts self-scoped player routes", () => {
    expect(isIdentityPath(["api", "me", "profile"])).toBe(true)
    expect(isIdentityPath(["api", "me", "attendance"])).toBe(true)
    expect(isIdentityPath(["api", "me", "reports", "111"])).toBe(true)
  })

  test("accepts the onboarding sync route", () => {
    expect(isIdentityPath(["api", "auth", "sync"])).toBe(true)
  })

  test("rejects capability and unknown routes", () => {
    expect(isIdentityPath(["api", "scan-video"])).toBe(false)
    expect(isIdentityPath(["api", "analyze-video"])).toBe(false)
    expect(isIdentityPath(["api", "job-status", "job-1"])).toBe(false)
    expect(isIdentityPath(["api", "chat", "stream"])).toBe(false)
    expect(isIdentityPath(["api", "conversation", "job-1"])).toBe(false)
    expect(isIdentityPath([])).toBe(false)
  })
})

describe("isSelfPath", () => {
  test("recognizes /api/me/*", () => {
    expect(isSelfPath(["api", "me", "profile"])).toBe(true)
    expect(isSelfPath(["api", "me"])).toBe(true)
  })

  test("rejects non-self identity routes", () => {
    expect(isSelfPath(["api", "org", "auth0|1"])).toBe(false)
    expect(isSelfPath(["api", "auth", "sync"])).toBe(false)
  })
})

describe("decodePathSegment", () => {
  test("decodes percent-encoded auth0 ids", () => {
    expect(decodePathSegment("auth0%7C123")).toBe("auth0|123")
  })

  test("falls back to the raw value on malformed input", () => {
    expect(decodePathSegment("%zz")).toBe("%zz")
  })
})