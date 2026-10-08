// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { scoreColor, themeColor, withAlpha } from '@/components/VideoPlayer'

// ── Canvas colour resolution: pure functions, so this IS machine-verified ────
//
// `VideoPlayer` paints its timeline and callouts on a `<canvas>`. It used to hardcode
// Tailwind's STOCK green-400 / amber-400 / red-500 (`#3cdc5a`, `#fbbf24`, `#ef4444`)
// against this app's own `--success #0f7b6c` / `--warning #d9730d` / `--danger
// #e03e3e` — so every marker was a different hue from the rest of the product.
//
// `ctx.fillStyle` cannot take `var(--x)`, which is why a literal existed at all. But a
// literal also cannot be correct, because `--success` is NOT the same in both themes
// (`#0f7b6c` light, `#4d9078` dark): any hardcoded value picks one theme and is wrong
// in the other. Resolving at paint time is the only answer that both uses the token
// and follows the theme.
//
// The canvas DRAWING is not assertable in jsdom — no 2D context, no pixels. These three
// helpers are the whole decision, and they are pure, so the drawing that consumes them
// needs no separate proof that the colour chosen is the token's.

const setToken = (token: string, value: string) => {
  document.documentElement.style.setProperty(token, value)
}

describe('themeColor', () => {
  test('reads the token off the document element', () => {
    setToken('--success', '#123456')
    expect(themeColor('--success', '#0f7b6c')).toBe('#123456')
  })

  test('trims, because a computed custom property carries leading whitespace', () => {
    setToken('--success', '  #abcdef  ')
    // An untrimmed value would land in `ctx.fillStyle` as an invalid colour, which
    // canvas silently ignores — leaving the previous fill in place. That is a wrong
    // colour with no error, so the trim is load-bearing rather than cosmetic.
    expect(themeColor('--success', '#0f7b6c')).toBe('#abcdef')
  })

  test('falls back when the token is absent', () => {
    expect(themeColor('--token-that-does-not-exist', '#0f7b6c')).toBe('#0f7b6c')
  })

  test('falls back on an EMPTY value, not just a missing one', () => {
    setToken('--empty-token', '   ')
    // The pair matters: `value || fallback` catches the empty string too, so a token
    // declared but blank degrades to the light-theme value instead of to `''`.
    expect(themeColor('--empty-token', '#0f7b6c')).toBe('#0f7b6c')
  })

  test('returns different values per theme for the same token', () => {
    // The assertion the whole fix rests on: the two themes genuinely differ, so a
    // single hardcoded literal cannot serve both. If a future theme change made
    // `--success` identical across themes this would fail — which is correct, because
    // it would mean the runtime resolution had become unnecessary.
    setToken('--success', '#0f7b6c')
    const light = themeColor('--success', '')
    setToken('--success', '#4d9078')
    const dark = themeColor('--success', '')
    expect(light).toBe('#0f7b6c')
    expect(dark).toBe('#4d9078')
    expect(light).not.toBe(dark)
  })
})

describe('withAlpha', () => {
  test('converts #rrggbb to rgba', () => {
    expect(withAlpha('#2383e2', 0.9)).toBe('rgba(35, 131, 226, 0.9)')
  })

  test('accepts a value with or without the leading hash', () => {
    expect(withAlpha('2383e2', 0.5)).toBe(withAlpha('#2383e2', 0.5))
  })

  test('returns the input unchanged when it is not 6-digit hex', () => {
    // The important half: a non-hex input must not be mangled into a wrong colour.
    // `rgb(...)`, `hsl(...)` and named colours are all legal `fillStyle` values, so
    // passing one through verbatim is correct and transforming it would not be.
    for (const v of ['rgba(1,2,3,0.4)', 'transparent', 'rebeccapurple']) {
      expect(withAlpha(v, 0.9)).toBe(v)
    }
  })

  test('does not accept a 3-digit shorthand as if it were 6-digit', () => {
    // `#abc` would be expanded to `#00aabb` by a naive left-pad, which is a plausible
    // wrong colour. Returning it unchanged keeps it valid for canvas, which understands
    // 3-digit hex natively — so the safer answer is also the simpler one.
    expect(withAlpha('#abc', 0.9)).toBe('#abc')
  })

  test('round-trips the primary token the progress fill uses', () => {
    setToken('--primary', '#2383e2')
    expect(withAlpha(themeColor('--primary', ''), 0.9)).toBe('rgba(35, 131, 226, 0.9)')
  })
})

describe('scoreColor', () => {
  const tokenFor = (score: number) => {
    setToken('--success', '#00ff00')
    setToken('--warning', '#ffff00')
    setToken('--danger', '#ff0000')
    return scoreColor(score)
  }

  test('maps the three bands onto the three tokens', () => {
    expect(tokenFor(10)).toBe('#00ff00')
    expect(tokenFor(8)).toBe('#00ff00')
    expect(tokenFor(7.9)).toBe('#ffff00')
    expect(tokenFor(5)).toBe('#ffff00')
    expect(tokenFor(4.9)).toBe('#ff0000')
    expect(tokenFor(0)).toBe('#ff0000')
  })

  test('emits NO stock-palette value, which is the defect being pinned', () => {
    // The old values, named explicitly. A sweep for "any hex in this file" would pass
    // the new code — it contains four fallbacks — so the assertion that actually holds
    // the defect is that none of these five ever reaches the canvas.
    const STOCK = ['#3cdc5a', '#fbbf24', '#ef4444', '#00a5ff']
    for (const score of [0, 4.9, 5, 7.9, 8, 10]) {
      expect(STOCK).not.toContain(tokenFor(score))
    }
  })

  test('falls back to the light-theme tokens when there is no DOM resolution', () => {
    // `themeColor` returns its fallback when `getComputedStyle` is unavailable or the
    // token is gone, and those fallbacks are the LIGHT values — recorded here so a
    // future edit to the fallback column is a deliberate act rather than a drift.
    const saved = document.documentElement.getAttribute('style')
    document.documentElement.removeAttribute('style')
    expect(scoreColor(9)).toBe('#0f7b6c')
    expect(scoreColor(6)).toBe('#d9730d')
    expect(scoreColor(1)).toBe('#e03e3e')
    if (saved !== null) document.documentElement.setAttribute('style', saved)
  })
})
// ── The call site, which the tests above do NOT prove ───────────────────────
//
// SOURCE-LEVEL TRIPWIRE, and the limit is stated rather than implied: the thirteen
// cases above prove the three helpers behave correctly, which is NOT the same claim as
// "the timeline uses them". Reverting the progress fill to `rgba(0,165,255,0.9)`
// left all thirteen green, because the helper tests never touch `drawTimeline`.
//
// A render-level assertion would need a real canvas: jsdom has no 2D context, and
// stubbing `getContext` means asserting on my own fake's call log rather than on
// anything the browser computed. That would read as a stronger check than it is — the
// repo's `typeScale.test.ts` problem in miniature. So the honest cheap check is that
// no canvas fill is assigned a literal colour at all: if every `fillStyle` in the draw
// path resolves through a token, this holds, and any new literal is caught here
// rather than by a human noticing the wrong hue in a screenshot.
describe('the canvas draw path assigns no literal colour', () => {
  const source = readFileSync(join(import.meta.dirname, 'VideoPlayer.tsx'), 'utf8')

  /**
   * The overlay chrome drawn ON the video: scrims behind the callout pills and the
   * white text on top of them. These are literal by necessity, not by oversight —
   * see the note on the case below. Quoted exactly as they appear in the source, so
   * the exemption is greppable.
   */
  const CHROME_LITERALS = [
    "'rgba(20,20,20,0.7)'",
    "'rgba(60,60,60,0.8)'",
    "'#ffffff'",
    "'rgba(0,0,0,0.5)'",
    "'rgba(220,220,220,0.9)'",
    "'rgba(30,30,30,0.9)'",
    "'rgba(10,10,10,0.75)'",
  ]

  const fillAssignments = [...source.matchAll(/fillStyle\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim())

  test('there are fillStyle assignments to check — not a vacuous pass', () => {
    // A regex that stopped matching would make the assertion below pass for the wrong
    // reason, which is the failure mode this repo has already paid for once.
    expect(fillAssignments.length).toBeGreaterThan(3)
  })

  /**
   * The colours that MUST be themed are the two the product owns: the score ramp and
   * the progress fill. They sit on the timeline bar, whose background is a themed
   * surface, so a literal there is a literal the design system does not own.
   *
   * The scrim and pill fills are deliberately NOT in this list. They are drawn on top
   * of arbitrary video frames — a coach's footage, not a themed surface — so a token
   * would be the wrong answer: `--foreground` is near-black in light mode and near-white
   * in dark, and neither reads against unpredictable footage. Those seven literals are
   * the documented exemption, and the `CHROME_LITERALS` list below pins the exemption
   * rather than leaving it implicit, so deleting one of them is a visible edit.
   */
  const PRODUCT_FILLS = ['withAlpha(themeColor(', 'scoreColor(']

  test('the progress fill resolves through --primary', () => {
    // Named individually because it is the one whose defect was a DIFFERENT colour
    // rather than a stock palette value: `rgba(0,165,255,0.9)` was iOS system blue,
    // visibly a different blue from every CTA in the product.
    expect(source).toContain("ctx.fillStyle = withAlpha(themeColor('--primary', '#2383e2'), 0.9)")
  })

  test('both score fills resolve through the token-backed ramp', () => {
    expect(source).toContain('ctx.fillStyle = scoreColor(evt.form_score)')
    expect(source).toContain('ctx.fillStyle = scoreColor(callout.event.form_score)')
  })

  test('no fillStyle assigns a raw product colour', () => {
    const literals = fillAssignments.filter(
      (a) => !PRODUCT_FILLS.some((p) => a.startsWith(p)) && !/^[A-Z_]+\.style\./.test(a),
    )
    // Asserted against the documented exemption list rather than `toEqual([])`: the
    // seven overlay-chrome literals are correct, so demanding zero literals would be
    // demanding the wrong thing — and would have been "fixed" by tokenizing scrims that
    // legitimately need to sit on video.
    const allowed = new Set(CHROME_LITERALS)
    expect(literals.filter((l) => !allowed.has(l))).toEqual([])
    // And the exemption stays honest: every literal it names must still be in the file,
    // so the list cannot rot into a blanket permission by outliving its members.
    for (const l of CHROME_LITERALS) {
      expect(source).toContain(l.slice(1, -1))
    }
  })

  test('no stock-palette or iOS-system hex appears anywhere in the file', () => {
    // Belt to the braces: a literal in a non-`fillStyle` position (a strokeStyle, a
    // shadow, a gradient stop) would pass the check above while still being a colour
    // the design system does not own.
    for (const hex of ['#3cdc5a', '#fbbf24', '#ef4444', '#00a5ff']) {
      expect(source.toLowerCase()).not.toContain(hex)
    }
  })
})
