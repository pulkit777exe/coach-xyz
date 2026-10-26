import { describe, expect, test } from 'vitest'
import { stripComments } from './stripComments'

/**
 * `stripComments` is shared by four guards (type scale, bespoke sizes, tailwind
 * defaults, colour), so a defect here is a defect in all four at once — and it
 * fails SILENTLY, by deleting source the guard then never scans.
 *
 * The case in `block opener inside a line comment must not swallow the file` is
 * not theoretical: `components/org/SettingsClient.tsx:59` ends a line comment
 * with `/api/org/` followed by an asterisk, and the first version of the helper
 * matched that as a block opener, running until the next real closer 90 lines
 * away. It deleted 134 real lines of `lib/org.ts`, 68 of that file and 37 of
 * `lib/meApi.ts`, and every one of the four guards reported clean while doing
 * it. Nothing happened to be hidden in those spans, which is exactly why it
 * survived as long as it did.
 */
describe('stripComments', () => {
  test('block opener inside a line comment must not swallow the file', () => {
    const src = [
      'export const A = 1',
      '    // players are blocked from /api/org/* and',
      'export const B = 2',
      'export const C = 3',
      'export const D = 4',
      'export const E = 5',
      'export const F = 6',
      'export const G = 7',
      'export const H = 8',
      'export const I = 9',
      'export const J = 10',
      'export const K = 11',
      '        {/* a real JSX block comment */}',
      'export const Z = 99',
    ].join('\n')

    const out = stripComments(src)

    // Every real declaration must survive. `B` is the one that used to vanish.
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'Z']) {
      expect(out, `declaration ${name} was deleted`).toContain(`export const ${name} =`)
    }
    // The trailing text of the line comment is still removed, opener included.
    expect(out).not.toContain('blocked from')
  })

  test('a genuine block comment is removed', () => {
    const src = 'export const A = 1\n/* gone */\nexport const B = 2'
    expect(stripComments(src)).toBe('export const A = 1\n\nexport const B = 2')
  })

  test('a multi-line block comment is removed without eating the code around it', () => {
    const src = 'export const A = 1\n/* line one\n   line two */\nexport const B = 2'
    const out = stripComments(src)
    expect(out).toContain('export const A = 1')
    expect(out).toContain('export const B = 2')
    expect(out).not.toContain('line one')
    expect(out).not.toContain('line two')
  })

  test('a URL in a line comment is not half-matched by the [^:] guard', () => {
    // Without `[^:]`, the `//` in `https://` is treated as a line-comment opener.
    const src = 'export const A = 1\n// see https://example.com/x\nexport const B = 2'
    const out = stripComments(src)
    expect(out).not.toContain('see https')
    expect(out).toContain('export const B = 2')
  })

  test('a line comment at column 0 is still removed', () => {
    // `^` needs the `m` flag to match at each line start, not just offset 0.
    const src = 'export const A = 1\n// gone\nexport const B = 2'
    expect(stripComments(src)).not.toContain('gone')
  })

  test('the kept character before a line comment is preserved', () => {
    // The old contract replaced with `$1`, so `a // c` kept its space and the
    // code before it stayed on the same line rather than being joined to the next.
    const src = 'const a = 1 // note\nconst b = 2'
    expect(stripComments(src)).toBe('const a = 1 \nconst b = 2')
  })
})
