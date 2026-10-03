/**
 * DOM behaviour shared by the interior overlay primitives (`modal`, `drawer`).
 *
 * Both of those render INLINE — not through a portal — so the rest of the page
 * is their DOM sibling tree rather than one known background element. That is
 * why `inertOutside` walks up to <body> marking every off-path sibling instead
 * of taking a single background ref: it is the only way to make "the page
 * behind is not reachable" true without a portal. A portal would be simpler,
 * but the server renderer rejects portals and these components render during
 * SSR.
 *
 * Split out of `modal.tsx` so the behaviour is unit-testable against fake
 * nodes: none of it can be reached through a static markup render, since every
 * function here runs in an effect.
 */

/** Sequential-focus candidates inside an overlay, in DOM order. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * The slice of the DOM these helpers touch. Narrower than `HTMLElement` on
 * purpose: it is exactly what the walk needs, and it lets a test hand in plain
 * objects instead of a browser.
 */
export interface OverlayNode {
  parentElement: OverlayNode | null
  // `unknown` items rather than `OverlayNode`: DOM collections are typed over
  // `Element`, and a real HTMLElement would not satisfy a stricter self-type
  // here. Only this file's own narrowing touches the items.
  children: ArrayLike<unknown>
  querySelectorAll(selectors: string): ArrayLike<unknown>
  focus(): void
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
}

/**
 * Focusable descendants of `root`, skipping the two states that make a node
 * present-but-unreachable: natively disabled, and hidden from assistive tech.
 * `inert` subtrees are already excluded from the tab order by the browser, and
 * the query cannot reach into one for a candidate worth taking.
 */
export function focusableIn(root: OverlayNode | null): OverlayNode[] {
  if (!root) return []
  return (Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)) as OverlayNode[]).filter(
    (node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true',
  )
}

/**
 * Move focus into the overlay on open. A dialog that is opened while focus
 * sits on the page behind it announces nothing until the user tabs, and the
 * first Tab then lands wherever the DOM happens to put the first focusable —
 * which for the scrim-backed overlays is the invisible backdrop button.
 * Falls back to the panel itself, which is why the panel carries
 * `tabIndex={-1}`.
 */
export function focusInitial(root: OverlayNode | null): void {
  if (!root) return
  const first = focusableIn(root)[0] ?? root
  first.focus()
}

/**
 * Mark everything outside `root`'s ancestor path inert, so Tab cannot walk out
 * of an `aria-modal` dialog into the page behind it. Returns the undo.
 *
 * `aria-modal` alone is a promise the DOM does not keep: it hides the
 * background from the accessibility tree while leaving it in the tab order.
 * `inert` is what actually removes it, and it needs no keydown handler — so
 * there is still no keyboard trap to get wrong. Only nodes this call added are
 * unmarked again, so a subtree that was already inert stays that way.
 */
export function inertOutside(root: OverlayNode | null, body: OverlayNode | null): () => void {
  const marked: OverlayNode[] = []
  let path: OverlayNode | null = root
  while (path && path !== body) {
    const parent: OverlayNode | null = path.parentElement
    if (!parent) break
    for (const sibling of Array.from(parent.children) as OverlayNode[]) {
      if (sibling === path) continue
      if (sibling.hasAttribute('inert')) continue
      sibling.setAttribute('inert', '')
      marked.push(sibling)
    }
    path = parent
  }
  return () => {
    for (const node of marked) node.removeAttribute('inert')
  }
}

/**
 * Remember what had focus so closing the overlay can hand it back, and return
 * the undo. Without this, dismissing a dialog drops the user at the top of the
 * document.
 */
export function restoreFocusOnClose(doc: { activeElement: unknown }): () => void {
  // `Document.activeElement` is typed `Element | null`, which has no focus();
  // at runtime it is always an HTMLElement or null. Duck-type rather than cast
  // at each call site.
  const active = doc.activeElement as { focus?: unknown } | null
  const previous = typeof active?.focus === 'function' ? (active as { focus(): void }) : null
  return () => previous?.focus()
}
