// ── UUID validation ─────────────────────────────────────────────────────────
// Single source of truth for the canonical (8-4-4-4-12) UUID pattern. Every
// route module and data helper validates ids with this one regex — do not
// redeclare it elsewhere.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
