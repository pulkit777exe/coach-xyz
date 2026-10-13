// ── Org entity facades (compat shim) ─────────────────────────────────────────
// The org client is split into per-subdomain modules under ./org/ (mirroring
// the server orgData subdomains). This file re-exports them so existing
// direct-path `@/lib/org` imports keep working; new code should import the
// subdomain file directly (no barrels — one module per import path).
export * from './org/types'
export * from './org/students'
export * from './org/student'
export * from './org/attendance'
export * from './org/schedule'
export * from './org/reports'
export * from './org/objectives'
export * from './org/findings'
export * from './org/compete'
export * from './org/plans'
export * from './org/wellness'
export * from './org/subscription'
export * from './org/performance'
export * from './org/overview'
export * from './org/email'
