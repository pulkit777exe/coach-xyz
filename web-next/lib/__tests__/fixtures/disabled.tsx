// Fixture for disabledOpacity.test.ts — never imported, never rendered.
//
// Positive control for the matcher: two numeric disabled opacities (which the guard must
// reject) alongside one token usage (which it must accept). Without this the assertion
// "no offenders" could pass because the matcher finds nothing at all — the failure mode this
// repo has paid for four separate times.
export const MIXED = 'disabled:opacity-30 disabled:opacity-70 disabled:opacity-disabled'
