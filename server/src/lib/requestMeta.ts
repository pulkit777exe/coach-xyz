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
    // Take the right-most (last proxy) entry — that is the immediate
    // sender of this request and cannot be spoofed by earlier XFF entries.
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
