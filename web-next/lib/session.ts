import { cache } from 'react'
import { auth0 } from './auth0'

/**
 * Auth0 session lookup memoized per request (RSC only). A single request
 * reads the session in generateMetadata, layouts, and the page body — this
 * makes the JWT verification / token refresh happen exactly once instead of
 * 2-3 times. Do not use in middleware (`proxy.ts`) or non-RSC contexts.
 */
export const getSession = cache(() => auth0.getSession())
