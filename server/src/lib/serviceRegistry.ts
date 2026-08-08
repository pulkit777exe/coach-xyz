export type ServiceStatus = "live" | "degraded" | "disabled"

export interface ServiceState {
  status: ServiceStatus
  reason?: string
  lastUpdated: number
}

const states = new Map<string, ServiceState>()

const listeners = new Set<(name: string, state: ServiceState) => void>()

export function serviceRegister(name: string, initial: ServiceStatus = "live", reason?: string): void {
  states.set(name, { status: initial, reason, lastUpdated: Date.now() })
}

export function serviceUpdate(name: string, status: ServiceStatus, reason?: string): void {
  const prev = states.get(name)
  if (!prev) {
    states.set(name, { status, reason, lastUpdated: Date.now() })
    return
  }

  prev.status = status
  prev.reason = reason
  prev.lastUpdated = Date.now()

  if (prev.status !== "live" || status !== prev.status) {
    for (const fn of listeners) fn(name, prev)
  }
}

export function serviceGet(name: string): ServiceState | undefined {
  return states.get(name)
}

export function serviceAll(): Record<string, ServiceState> {
  return Object.fromEntries(states)
}

export function serviceOnStatusChange(fn: (name: string, state: ServiceState) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function serviceIsHealthy(): boolean {
  if (states.size === 0) return true
  for (const s of states.values()) {
    if (s.status === "disabled") return false
  }
  return true
}
