export type RequestMeta = {
  clientIp: string | null
  userAgent: string | null
}

const normalize = (value: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const getClientIp = (request: Request): string | null => {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // Trust assumption: the immediate peer is the platform proxy, which
    // appends the true client IP last. A client reaching us directly
    // controls this entire header (including the right-most entry), so
    // IP-keyed buckets are rotation-resistant, not rotation-proof —
    // never use the IP as an authentication signal, and prefer
    // unguessable keys (session/job tokens) for limits that matter.
    const parts = forwarded.split(',').map((s) => s.trim())
    return normalize(parts[parts.length - 1] ?? parts[0])
  }

  return normalize(request.headers.get('x-real-ip'))
}

export const readRequestMeta = (request: Request): RequestMeta => {
  return {
    clientIp: getClientIp(request),
    userAgent: normalize(request.headers.get('user-agent')),
  }
}
