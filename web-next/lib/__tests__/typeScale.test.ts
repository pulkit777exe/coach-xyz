import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Pins the semantic type scale in app/globals.css to the utility list in
// docs/DESIGN_FOUNDATIONS.md (§Typography → Semantic size utilities), the
// same single-sided-edit tripwire as permissions.test.ts. Two contracts:
//   1. every role exists with the documented px value;
//   2. utilities are FONT-SIZE-ONLY — line-height stays at the call site so
//      `text-meta` is pixel-identical to `text-[13px]` (an embedded leading
//      would shift every line box that inherits from a parent).

const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8')
const docs = readFileSync(
  fileURLToPath(new URL('../../../docs/DESIGN_FOUNDATIONS.md', import.meta.url)),
  'utf8',
)

const SCALE: Record<string, string> = {
  label: '11px',
  caption: '12px',
  meta: '13px',
  body: '14px',
  title: '15px',
  lead: '16px',
}

describe('type scale (semantic size utilities)', () => {
  for (const [name, px] of Object.entries(SCALE)) {
    it(`--text-${name} is ${px}`, () => {
      expect(css).toContain(`--text-${name}: ${px};`)
    })

    it(`@utility text-${name} emits font-size only`, () => {
      const util = css.match(new RegExp(`@utility text-${name} \\{[^}]*\\}`))
      expect(util, `missing @utility text-${name}`).toBeTruthy()
      expect(util![0]).toContain(`font-size: var(--text-${name});`)
      expect(util![0]).not.toContain('line-height')
      expect(util![0]).not.toMatch(/font-weight|letter-spacing|text-transform/)
    })

    it(`docs mention text-${name} (CSS and DESIGN_FOUNDATIONS stay in sync)`, () => {
      expect(docs).toContain(`\`text-${name}\``)
    })
  }
})
