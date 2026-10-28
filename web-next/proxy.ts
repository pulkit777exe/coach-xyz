import { auth0 } from './lib/auth0'

// NOTE: Next.js picks up middleware from middleware.ts (not this file).
// This file is kept as a reference; the actual middleware is at middleware.ts.
export async function proxy(request: Request) {
  const authResponse = await auth0.middleware(request)
  return authResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
