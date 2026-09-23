export const SPORT_EMOJI: Record<string, string> = {
  basketball: '🏀',
  football: '⚽',
  cricket: '🏏',
  tennis: '🎾',
  baseball: '⚾',
  hockey: '🏒',
  unknown: '🎯',
}

export type SportPosition = {
  id: string
  label: string
  description: string
}

const positionsCache = new Map<string, SportPosition[]>()

/**
 * Canonical position vocabulary for a sport, served from the backend sport
 * packs (same source as analysis). Cached per sport; unknown sports and
 * backend failures resolve to [] so forms fall back to free text.
 */
export async function getSportPositions(sport: string): Promise<SportPosition[]> {
  const key = sport.trim().toLowerCase()
  if (!key) return []
  const hit = positionsCache.get(key)
  if (hit) return hit
  try {
    const { apiFetch, IDENTITY_BASE } = await import('./api')
    const res = await apiFetch<{ positions: SportPosition[] }>(
      `${IDENTITY_BASE}/api/sports/${encodeURIComponent(key)}/positions`,
    )
    const positions = Array.isArray(res.positions) ? res.positions : []
    positionsCache.set(key, positions)
    return positions
  } catch {
    return []
  }
}
