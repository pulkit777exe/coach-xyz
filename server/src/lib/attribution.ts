import { createHmac, timingSafeEqual } from "node:crypto"

// ── Verified attribution tokens ──────────────────────────────────────────────
// Browser-direct capability routes (/api/scan-video, /api/analyze-video) cannot
// carry x-verified-auth0-id (the browser never passes through the identity
// proxy for uploads/SSE), so the web app mints a short-lived HMAC token bound
// to the verified session sub and the browser sends it as `x-attribution`.
// The server verifies the signature with the shared SERVICE_TOKEN and treats
// the embedded sub as the caller's identity — never trusting a raw header.
//
// Token shape: `<sub>.<expEpochMs>.<hexHmac>` where the HMAC covers
// `<sub>.<expEpochMs>` keyed by SERVICE_TOKEN.

const ATTRIBUTION_TTL_MS = 10 * 60 * 1000

export function mintAttributionToken(
  sub: string,
  secret: string | undefined = process.env.SERVICE_TOKEN,
  now: number = Date.now(),
): { token: string; exp: number } | null {
  if (!secret || !sub) return null
  const exp = now + ATTRIBUTION_TTL_MS
  const data = `${sub}.${exp}`
  const sig = createHmac("sha256", secret).update(data).digest("hex")
  return { token: `${data}.${sig}`, exp }
}

/**
 * Verifies an attribution token and returns the subscriber id embedded in it,
 * or null when the token is missing, malformed, expired, or mismatched.
 */
export function verifyAttributionToken(
  token: string | null | undefined,
  secret: string | undefined = process.env.SERVICE_TOKEN,
  now: number = Date.now(),
): string | null {
  if (!token || !secret) return null
  const lastDot = token.lastIndexOf(".")
  if (lastDot <= 0) return null
  const data = token.slice(0, lastDot)
  const sig = token.slice(lastDot + 1)
  if (!data || !sig) return null

  const sep = data.lastIndexOf(".")
  if (sep <= 0) return null
  const sub = data.slice(0, sep)
  const expStr = data.slice(sep + 1)
  if (!sub) return null

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || now > exp) return null

  const expected = Buffer.from(
    createHmac("sha256", secret).update(data).digest("hex"),
    "hex",
  )
  const provided = Buffer.from(sig, "hex")
  if (expected.length !== provided.length) return null
  if (!timingSafeEqual(expected, provided)) return null
  return sub
}