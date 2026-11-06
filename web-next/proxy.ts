import { NextResponse, type NextRequest } from 'next/server'
import { auth0 } from './lib/auth0'
import { buildCsp } from './lib/securityHeaders'

// Next.js 16 file convention: proxy.ts replaces middleware.ts. The Auth0
// client handles /auth/login, /auth/callback, /auth/logout and session-cookie
// refresh; page-level guards still call getSession() and redirect.
//
// A fresh CSP nonce is generated per request. It is forwarded as a request
// header (Next.js reads the policy and tags its bootstrap scripts) and as the
// response policy. Auth0's pass-through response is rebuilt with
// NextResponse.next({ request }) so the nonce survives; its Set-Cookie headers
// are copied so rolling sessions keep working.
export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const authResponse = await auth0.middleware(request)
  const isPassThrough = authResponse.headers.get('x-middleware-next') === '1'

  if (!isPassThrough) {
    authResponse.headers.set('content-security-policy', csp)
    return authResponse
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  authResponse.headers.forEach((value, key) => {
    if (key !== 'x-middleware-next') response.headers.append(key, value)
  })
  response.headers.set('content-security-policy', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
