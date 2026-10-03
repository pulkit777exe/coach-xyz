// The half of the interior-overlay fix that a static markup render cannot see.
//
// `renderToStaticMarkup` runs no effects, so nothing in modal.tsx / drawer.tsx
// that happens on open — focus moving in, the page behind going inert, focus
// coming back on close — is observable from markup. It lives in
// components/interior/overlay-a11y.ts as small functions over a narrow node
// interface precisely so it can be driven here with plain objects.
//
// The source-level tripwires at the bottom cover the remaining gap: that
// modal.tsx and drawer.tsx actually CALL these on open.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  FOCUSABLE_SELECTOR,
  focusInitial,
  focusableIn,
  inertOutside,
  restoreFocusOnClose,
  type OverlayNode,
} from '@/components/interior/overlay-a11y'

/** Minimal fake node: attributes are a Set, focus() is a spy. */
function node(init: { name?: string; children?: FakeNode[] } = {}): FakeNode {
  const attrs = new Map<string, string>()
  const el: FakeNode = {
    name: init.name ?? 'div',
    children: init.children ?? [],
    parentElement: null,
    attrs,
    focus: vi.fn(),
    querySelectorAll: () => [],
    setAttribute(n: string, v: string) {
      attrs.set(n, v)
    },
    removeAttribute(n: string) {
      attrs.delete(n)
    },
    hasAttribute(n: string) {
      return attrs.has(n)
    },
    getAttribute(n: string) {
      return attrs.get(n) ?? null
    },
  }
  for (const child of el.children as FakeNode[]) child.parentElement = el
  return el
}

interface FakeNode extends OverlayNode {
  name: string
  attrs: Map<string, string>
}

describe('focusableIn', () => {
  it('excludes natively disabled and aria-hidden candidates', () => {
    const ok = node({ name: 'button' })
    const disabled = node({ name: 'button' })
    disabled.setAttribute('disabled', '')
    const hidden = node({ name: 'a' })
    hidden.setAttribute('aria-hidden', 'true')
    const root = node()
    root.querySelectorAll = () => [ok, disabled, hidden]

    expect(focusableIn(root)).toEqual([ok])
  })

  it('is empty for a missing root', () => {
    expect(focusableIn(null)).toEqual([])
  })

  it('asks for the sequential-focus candidates, not everything focusable', () => {
    // The panel itself carries tabIndex={-1} and must NOT be in this list, or
    // focusInitial would pick the panel over its first real control.
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])')
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})

describe('focusInitial', () => {
  it('focuses the first focusable child', () => {
    const close = node({ name: 'button' })
    const input = node({ name: 'input' })
    const panel = node({ children: [close, input] })
    panel.querySelectorAll = () => [close, input]

    focusInitial(panel)
    expect(close.focus).toHaveBeenCalledTimes(1)
    expect(input.focus).not.toHaveBeenCalled()
  })

  it('falls back to the panel when it holds nothing focusable', () => {
    // The panel has tabIndex={-1} for exactly this: a dialog holding only text
    // must still take focus, or focus stays on the page behind it.
    const panel = node()
    panel.querySelectorAll = () => []

    focusInitial(panel)
    expect(panel.focus).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without a panel', () => {
    expect(() => focusInitial(null)).not.toThrow()
  })
})

describe('inertOutside', () => {
  /** sidebar > (overlay > panel) + main, the shape of the analysis page. */
  function page() {
    const panel = node({ name: 'panel' })
    const overlay = node({ name: 'overlay', children: [panel] })
    const scrim = node({ name: 'scrim' })
    const main = node({ name: 'main' })
    const sidebar = node({ name: 'sidebar', children: [main, overlay, scrim] })
    return { panel, overlay, scrim, main, sidebar }
  }

  it('marks the siblings of the overlay inert, at every level', () => {
    const { panel, overlay, scrim, main } = page()
    inertOutside(overlay, node({ name: 'body' }))

    expect(scrim.hasAttribute('inert')).toBe(true)
    expect(main.hasAttribute('inert')).toBe(true)
    // …and nothing on the overlay's own path, or the dialog would disable itself.
    expect(overlay.hasAttribute('inert')).toBe(false)
    expect(panel.hasAttribute('inert')).toBe(false)
  })

  it('undoes exactly what it marked', () => {
    const { overlay, scrim, main } = page()
    const undo = inertOutside(overlay, node({ name: 'body' }))
    expect(scrim.hasAttribute('inert')).toBe(true)

    undo()
    expect(scrim.hasAttribute('inert')).toBe(false)
    expect(main.hasAttribute('inert')).toBe(false)
  })

  it('leaves a subtree that was already inert alone, and keeps it inert on undo', () => {
    const { overlay, main } = page()
    main.setAttribute('inert', '')
    const undo = inertOutside(overlay, node({ name: 'body' }))

    expect(main.hasAttribute('inert')).toBe(true)
    undo()
    // Undoing must not un-inert something the page had inert itself.
    expect(main.hasAttribute('inert')).toBe(true)
  })

  it('stops at the body and does not inert it', () => {
    const { overlay, sidebar } = page()
    const body = node({ name: 'body', children: [sidebar] })
    inertOutside(overlay, body)

    expect(sidebar.hasAttribute('inert')).toBe(false)
    expect(body.hasAttribute('inert')).toBe(false)
  })

  it('is inert to a null overlay', () => {
    expect(() => inertOutside(null, node())).not.toThrow()
  })
})

describe('restoreFocusOnClose', () => {
  it('hands focus back to whatever had it before', () => {
    const trigger = node({ name: 'button' })
    const undo = restoreFocusOnClose({ activeElement: trigger })
    undo()
    expect(trigger.focus).toHaveBeenCalledTimes(1)
  })

  it('is inert when nothing had focus', () => {
    expect(() => restoreFocusOnClose({ activeElement: null })()).not.toThrow()
  })
})

describe('source tripwires: both overlays wire the helpers on open', () => {
  const read = (name: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../components/interior/${name}.tsx`, import.meta.url)),
      'utf8',
    )

  for (const name of ['modal', 'drawer']) {
    it(`${name}.tsx moves focus in, inert-outs the page, and restores focus`, () => {
      const src = read(name)
      expect(src).toContain('focusInitial(panelRef.current)')
      expect(src).toContain('inertOutside(rootRef.current, document.body)')
      expect(src).toContain('restoreFocusOnClose(document)')
      // …inside the `if (!open) return` effect, not merely imported.
      expect(src).toMatch(/if \(!open\) return[\s\S]*focusInitial\(panelRef\.current\)/)
      // All three are cleaned up when the overlay closes.
      expect(src).toContain('undoInert()')
      expect(src).toContain('undoFocus()')
    })

    it(`${name}.tsx keeps Escape dismissal`, () => {
      const src = read(name)
      expect(src).toContain("if (e.key === 'Escape')")
    })

    it(`${name}.tsx keeps a labelled-by title association`, () => {
      const src = read(name)
      expect(src).toContain('const titleId = useId()')
      expect(src).toContain('aria-labelledby={titleId}')
      expect(src).toContain('<h2 id={titleId}')
    })
  }

  it('the Drawer marks itself inert while closed', () => {
    const src = read('drawer')
    expect(src).toContain('{...(open ? {} : { inert: true })}')
  })

  it('neither overlay reintroduces a focusable full-screen backdrop', () => {
    // The regression the audit found: a `<button aria-label="Close">` scrim,
    // which is the first focusable node in the dialog.
    for (const name of ['modal', 'drawer']) {
      expect(read(name)).not.toContain('aria-label="Close"')
    }
  })
})
