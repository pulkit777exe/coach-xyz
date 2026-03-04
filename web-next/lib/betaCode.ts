const STORAGE_KEY = "coachai_beta_code"

export function getBetaCode(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(STORAGE_KEY)
}

export function setBetaCode(code: string): void {
  localStorage.setItem(STORAGE_KEY, code.trim().toLowerCase())
}

export function clearBetaCode(): void {
  localStorage.removeItem(STORAGE_KEY)
}
