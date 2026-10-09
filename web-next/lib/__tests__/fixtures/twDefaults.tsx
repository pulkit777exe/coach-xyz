// Fixture for tailwindDefaultSizes.test.ts — never imported, never rendered.
//
// Carries the three Tailwind default size tokens the migration removed, plus one semantic
// size WITH an explicit `leading-*`. Used as the positive control so "no offenders" cannot be
// reported by a matcher that finds nothing at all.
export const DEFAULTS = 'text-sm text-xs text-base'
export const WITH_LEADING = 'text-body leading-5'
