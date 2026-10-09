// Fixture for tokenUsage.test.ts — never imported, never rendered.
//
// One instance of every shape the guard rejects, so each matcher is exercised through the
// same code path the tree-wide assertion uses. Without this, "no offenders" is
// indistinguishable from a matcher that finds nothing — the failure mode this repo has paid
// for four separate times.
export const BYPASSES = [
  'bg-input', // border token used as a field fill
  'divide-foreground/9', // hairline spelled as foreground at an alpha
  'focus-visible:ring-[3px]', // non-canonical focus ring width
  'focus-visible:ring-ring/50', // non-canonical focus ring alpha
  'duration-[120ms]', // raw duration where --dur-fast exists
  'ease-[cubic-bezier(0.23,1,0.32,1)]', // inline copy of --ease-out
].join(' ')

export const INLINE_FONT_SIZE = <span style={{ fontSize: 11 }} />
