import { describe, expect, test } from "bun:test"

import {
  mintAttributionToken,
  verifyAttributionToken,
} from "../src/lib/attribution"

const SECRET = "test-service-token"

describe("attribution tokens", () => {
  test("round-trips a valid token into its sub", () => {
    const minted = mintAttributionToken("auth0|123", SECRET, 1_000_000)
    expect(minted).not.toBeNull()
    const sub = verifyAttributionToken(minted!.token, SECRET, 1_000_000)
    expect(sub).toBe("auth0|123")
  })

  test("accepts a token within its TTL window", () => {
    const minted = mintAttributionToken("auth0|123", SECRET, 1_000_000)
    const sub = verifyAttributionToken(minted!.token, SECRET, 1_000_000 + 5 * 60 * 1000)
    expect(sub).toBe("auth0|123")
  })

  test("rejects an expired token", () => {
    const minted = mintAttributionToken("auth0|123", SECRET, 1_000_000)
    const sub = verifyAttributionToken(minted!.token, SECRET, 1_000_000 + 11 * 60 * 1000)
    expect(sub).toBeNull()
  })

  test("rejects a tampered signature", () => {
    const minted = mintAttributionToken("auth0|123", SECRET, 1_000_000)
    const tampered = `${minted!.token.slice(0, -1)}0`
    expect(verifyAttributionToken(tampered, SECRET, 1_000_000)).toBeNull()
  })

  test("rejects a token minted with a different secret", () => {
    const minted = mintAttributionToken("auth0|123", "other-secret", 1_000_000)
    expect(verifyAttributionToken(minted!.token, SECRET, 1_000_000)).toBeNull()
  })

  test("rejects a token whose embedded sub is altered", () => {
    const minted = mintAttributionToken("auth0|123", SECRET, 1_000_000)
    const [, exp, sig] = minted!.token.split(".")
    const forged = `auth0|999.${exp}.${sig}`
    expect(verifyAttributionToken(forged, SECRET, 1_000_000)).toBeNull()
  })

  test("rejects malformed tokens", () => {
    expect(verifyAttributionToken(null, SECRET)).toBeNull()
    expect(verifyAttributionToken("", SECRET)).toBeNull()
    expect(verifyAttributionToken("not-a-token", SECRET)).toBeNull()
    expect(verifyAttributionToken(".sig", SECRET)).toBeNull()
  })

  test("is inert when no secret is configured", () => {
    const minted = mintAttributionToken("auth0|123", "")
    expect(minted).toBeNull()
    expect(verifyAttributionToken("a.1.deadbeef", "")).toBeNull()
  })
})