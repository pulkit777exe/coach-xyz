export type RequestMeta = {
  betaCode: string | null
  clientIp: string | null
  userAgent: string | null
}

const normalize = (value: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const getClientIp = (request: Request): string | null => {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]
    return normalize(first)
  }

  return normalize(request.headers.get("x-real-ip"))
}

export const readRequestMeta = (request: Request): RequestMeta => {
  const betaCodeHeader = request.headers.get("x-beta-code")
  return {
    betaCode: normalize(betaCodeHeader)?.toLowerCase() ?? null,
    clientIp: getClientIp(request),
    userAgent: normalize(request.headers.get("user-agent")),
  }
}
