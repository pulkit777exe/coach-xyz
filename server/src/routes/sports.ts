import { Elysia } from 'elysia'

import { ENGINE_URL, engineServiceHeaders, requestIdFrom } from '../lib/engine'

// ── Sport vocabulary proxy ─────────────────────────────────────────────────
// Static per-sport vocabularies (positions) served from the engine's sport
// packs so roster UI never drifts from analysis vocabulary. Guard-exempt
// like /health: no identity needed for static config. Responses are cached
// in memory (packs change on deploy, not at runtime); engine failures
// degrade to an empty list rather than failing roster forms.
export type SportPosition = {
  id: string
  label: string
  description: string
}

const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; positions: SportPosition[] }>()

export const cleanPositions = (raw: unknown): SportPosition[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object' && !Array.isArray(e),
    )
    .filter(
      (e) =>
        typeof e.id === 'string' && e.id.trim() && typeof e.label === 'string' && e.label.trim(),
    )
    .map((e) => ({
      id: (e.id as string).trim(),
      label: (e.label as string).trim(),
      description: typeof e.description === 'string' ? e.description : '',
    }))
}

export const sportPositionsRoute = new Elysia({ prefix: '/api/sports' }).get(
  '/:sport/positions',
  async ({ params, request, set }) => {
    const sport = (params.sport ?? '').toLowerCase().slice(0, 60)
    if (!/^[a-z]+$/.test(sport)) {
      set.status = 400
      return { sport, positions: [] }
    }
    const hit = cache.get(sport)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      set.status = 200
      return { sport, positions: hit.positions }
    }
    try {
      const res = await fetch(`${ENGINE_URL}/sports/${sport}/positions`, {
        headers: engineServiceHeaders(requestIdFrom(request)),
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const body = (await res.json()) as { positions?: unknown }
        const positions = cleanPositions(body.positions)
        cache.set(sport, { at: Date.now(), positions })
        set.status = 200
        return { sport, positions }
      }
    } catch {
      // Engine unreachable — degrade below.
    }
    set.status = 200
    return { sport, positions: hit?.positions ?? [] }
  },
)
