import { auth0 } from '@/lib/auth0'
import { isIdentityPath, sanitizeServicePath } from '@/lib/serviceProxy'
import { NextRequest, NextResponse } from 'next/server'

// ── Service proxy for identity-bearing backend routes ──────────────────────
// The browser only talks to these through this same-origin handler. It reads
// the verified Auth0 session, then injects x-service-token + x-verified-auth0-id
// (the session's sub) before forwarding to the backend (which authorizes both
// the owner and active org members via serviceGuard's membership check).
//
// Only identity-bearing routes are proxied. Capability-token routes
// (scan/analyze/job-status/download/chat) stay direct-browser→backend so
// uploads and SSE streams never pass through Vercel.

const BACKEND = process.env.NEXT_PUBLIC_API_URL

/**
 * Proxy-own failures (misconfiguration, non-identity paths, missing
 * session, unreachable backend) in the canonical CoachAIError shape so
 * apiFetch preserves their messages instead of falling back to
 * `Request failed (<status>)`. Backend error bodies stream through
 * untouched below — only these four are synthesized here.
 */
function proxyError(code: string, message: string, status: number, retryable: boolean) {
  return NextResponse.json({ code, message, layer: 'server', retryable }, { status })
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
])

type RouteContext = { params: Promise<{ path?: string[] }> }

async function proxy(request: NextRequest, ctx: RouteContext) {
  if (!BACKEND) {
    return proxyError('BACKEND_NOT_CONFIGURED', 'Backend not configured.', 500, false)
  }

  const path = (await ctx.params).path ?? []
  if (!isIdentityPath(path)) {
    return proxyError('NOT_FOUND', 'Not found.', 404, false)
  }

  // Reject traversal: decoded segments must be plain names, no ../ or slashes.
  const safePath = sanitizeServicePath(path)
  if (!safePath) {
    return proxyError('NOT_FOUND', 'Not found.', 404, false)
  }

  const session = await auth0.getSession()
  const verifiedSub = session?.user?.sub
  if (!verifiedSub) {
    return proxyError('UNAUTHORIZED', 'Unauthorized.', 401, false)
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let body: ArrayBuffer | undefined
  if (hasBody) {
    body = await request.arrayBuffer()
  }

  // The backend is the authorizer: it accepts the org owner OR any active
  // org_members row for the org named by the path. Path-scoped ids are no
  // longer compared against the session sub here — the session sub is the
  // caller's true identity and membership is resolved server-side.
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  // End-to-end trace correlation: the client stamps every call, and the
  // backend forwards it to the engine — don't drop it at the proxy hop.
  const requestId = request.headers.get('x-request-id')
  if (requestId) headers.set('x-request-id', requestId)
  if (process.env.SERVICE_TOKEN) headers.set('x-service-token', process.env.SERVICE_TOKEN)
  headers.set('x-verified-auth0-id', verifiedSub)

  let backendRes: Response
  try {
    // Forward the query string — pagination/filter params live there.
    const search = request.nextUrl.search ?? ''
    backendRes = await fetch(`${BACKEND}/${safePath.join('/')}${search}`, {
      method: request.method,
      headers,
      body: hasBody ? body : undefined,
      redirect: 'manual',
    })
  } catch {
    return proxyError('BAD_GATEWAY', 'Backend service is temporarily unavailable.', 502, true)
  }

  const responseHeaders = new Headers(backendRes.headers)
  for (const name of HOP_BY_HOP) responseHeaders.delete(name)

  return new Response(backendRes.body, {
    status: backendRes.status,
    headers: responseHeaders,
  })
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx)
}
export async function POST(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx)
}
export async function PUT(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx)
}
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx)
}
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  return proxy(request, ctx)
}
