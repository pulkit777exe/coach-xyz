import { queryJson } from './client'
import { meUrl } from './transport'

// ── Attribution tokens ───────────────────────────────────────────────────────
// Short-lived tokens binding the verified session sub, sent as `x-attribution`
// on browser-direct capability routes (scan/analyze/status/chat/conversation)
// so the backend can attribute uploads without trusting a raw client header.
// Minted via GET through the identity proxy (never blocked by upload size
// limits); cached until expiry to avoid an extra round-trip per scan/analyze
// pair. The store is injectable (`fetchMint`/`now`) so tests mint once per
// expiry against a fake instead of the network.

export type AttributionMint = { token: string; exp: number }

export type AttributionDeps = {
  fetchMint?: () => Promise<AttributionMint>
  now?: () => number
}

export function createAttributionStore(deps: AttributionDeps = {}) {
  const fetchMint =
    deps.fetchMint ?? (() => queryJson<AttributionMint>(meUrl('/attribution/mint')))
  const now = deps.now ?? (() => Date.now())
  let cache: AttributionMint | null = null

  return {
    async getToken(): Promise<string | null> {
      if (cache && cache.exp > now()) return cache.token
      cache = null
      try {
        const res = await fetchMint()
        cache = res
        return res.token
      } catch {
        return null
      }
    },
    reset(): void {
      cache = null
    },
    peek(): AttributionMint | null {
      return cache
    },
  }
}

export type AttributionStore = ReturnType<typeof createAttributionStore>

/** Process-wide singleton backing the `getAttributionToken` facade. */
export const attributionStore = createAttributionStore()

export async function getAttributionToken(): Promise<string | null> {
  return attributionStore.getToken()
}
