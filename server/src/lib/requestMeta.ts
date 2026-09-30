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
    // Right-most entry: correct behind an appending proxy (Render adds the
    // real client IP last, so prepended spoofs don't move it). Direct to
    // origin the whole header is caller-controlled, so IP-keyed limits are
    // abuse friction, not a billing boundary — anonymous Gemini spend is
    // capped by quotas that assume the proxy is in front.
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
