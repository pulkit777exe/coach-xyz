import { describe, expect, test } from 'vitest'

import { buildCsp } from '../securityHeaders'

describe('buildCsp', () => {
  test('uses the per-request nonce and strict-dynamic for scripts', () => {
    const csp = buildCsp('abc123', { dev: false })
    expect(csp).toContain("'nonce-abc123'")
    expect(csp).toContain("'strict-dynamic'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
  })

  test('does not allow eval in production', () => {
    expect(buildCsp('n', { dev: false })).not.toContain("'unsafe-eval'")
    expect(buildCsp('n', { dev: true })).toContain("'unsafe-eval'")
  })

  test('does not allow any remote image host or the retired Upstash host', () => {
    const csp = buildCsp('n', { dev: false })
    expect(csp).not.toContain('upstash')
    expect(csp).toContain(
      "img-src 'self' data: blob: https://*.auth0.com https://s.gravatar.com https://*.googleusercontent.com https://*.githubusercontent.com",
    )
  })

  test('upgrades insecure requests only in production', () => {
    expect(buildCsp('n', { dev: false })).toContain('upgrade-insecure-requests')
    expect(buildCsp('n', { dev: true })).not.toContain('upgrade-insecure-requests')
  })
})
