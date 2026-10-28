// ─────────────────────────────────────────────────────────────────────────────
// Render sweep: every interactive element has an accessible name.
//
// WHY THIS FILE EXISTS
// Four accessibility blockers shipped through `components/` because nothing
// there had ever been rendered: a pointer-only rename affordance (an
// <h1 onClick>), a Ctrl+K dialog with no name (Base UI's `DialogPopup` takes
// its name from a `titleElementId` only `DialogTitle` sets), and two overlays
// claiming `aria-modal="true"` with no name and no focus move. All four were
// found later by source-level greps, which cannot see what markup a component
// actually produces. `lib/__tests__/a11ySource.test.ts` still holds those
// tripwires; this file holds the class they were standing in for.
//
// A test-location default (`include: ['lib/**/*.test.ts']`) is what made this
// possible: everything under `components/` was unmatched, so all 28 test files
// sat in `lib/__tests__`. The globs are now `lib|components|app`.
//
// WHAT IS AVAILABLE (measured, not assumed)
// `environment` is `node` — no jsdom, no happy-dom, no testing-library, and
// none may be added. `renderToStaticMarkup` still renders a component's initial
// output: `useState` initialisers run, and `useEffect` does not, so a component
// that fetches on mount renders its server-state props and nothing else. That
// is enough for the whole name check, because a name is in the markup.
//
// WHAT THIS FILE CANNOT SEE (read this before trusting a green run)
// 1. Portal-only content. Base UI's `Dialog`/`DropdownMenu`/`Select` render
//    their popups into `document.body`, and `DialogPortal` emits nothing at all
//    in a server render — so only the trigger is reachable here. This is why
//    `GlobalSearch`'s dialog name is pinned by a grep in `a11ySource.test.ts`
//    rather than here.
// 2. Anything behind an interaction. `renderToStaticMarkup` dispatches no
//    events and runs no effects, so a `useState`-gated panel (the Share modal,
//    every "open" dialog in a client component) renders shut and its contents
//    are never in the markup. Components in this file are rendered in the state
//    a server render produces — the *initial* state — and the header of each
//    case says what that state is.
// 3. Focus management. `overlay-a11y.ts`'s `focusInitial` / `inertOutside` /
//    `restoreFocusOnClose` are effect-only. Driven directly with fake nodes in
//    `a11yOverlay.test.ts`; here they are out of reach.
// 4. A name is a name *in context*. Name-from-content is accepted here, so a
//    Base UI combobox whose only name is its own current value ("Dark") passes
//    this sweep. That is correct for this assertion and not sufficient for the
//    product; `a11ySource.test.ts` holds the stricter SelectTrigger grep.
//
// COVERAGE IS ASSERTED, NOT IMPLIED
// `REGISTRY` below names every `.tsx` under `components/` (108 files as of this
// writing). Each entry either renders or carries a documented `skip` reason. The
// final describe block asserts the render/skip split against an expected list,
// so adding a component that cannot render is a visible diff rather than a
// silent hole — a sweep that quietly covered 20 of 100 components would read as
// complete, which is worse than no sweep. The count test also pins that the
// sweep actually examined interactive elements, so a registry of empty renders
// cannot pass.
//
// The parser below is a real one, not a regex: name resolution needs an id →
// element map (`aria-labelledby`), label association (`<label for>` / ancestor),
// and `aria-hidden` subtrees excluded from a name but not from the sweep. No
// dependency may be added, so it is here.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'
import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PreferencesProvider } from '@/lib/preferences'

// ── Inlining Base UI's portal ─────────────────────────────────────────────────
//
// 9ui's `DialogContent` wraps its children in Base UI's `DialogPortal`, which has
// NO server-render output at all — a portal needs a document to portal into. That
// put seven dialogs outside the sweep entirely, and `keepMounted` does not help:
// verified directly, both a plain portal and a `keepMounted` one render as nothing,
// with `aria-expanded` stuck at `false` on an `open` dialog.
//
// Mocking `Portal`, `Popup` and `Backdrop` to plain wrappers puts the CONTENT back
// into the markup, which is what the name check needs. Measured effect: before,
// `StudentFormDialog` rendered 0 bytes; after, 17 292 bytes with 10 inputs and 14
// labels. Nothing is lost for this assertion — a control's accessible name does not
// depend on whether it is portal-rendered — and the portal mechanics themselves are
// out of scope, which is what the existing source-level greps are for.
//
// This is a deliberate fidelity reduction and is named as one: the sweep checks the
// CONTENT of a dialog, not that Base UI mounts it into document.body. What it
// cannot catch is a defect in the portal wiring itself.
vi.mock('@base-ui/react', async () => {
  const actual = await vi.importActual<{ Dialog: Record<string, unknown> }>('@base-ui/react')
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Portal: (props: Record<string, unknown>) =>
        createElement('div', { 'data-swept-portal': '' }, props.children as ReactNode),
      Popup: (props: Record<string, unknown>) => {
        const { children, ...rest } = props
        return createElement('div', { ...rest, 'data-swept-popup': '' }, children as ReactNode)
      },
      Backdrop: () => null,
    },
  }
})

/** `next/navigation` throws its "expected an app router to be mounted" invariant. */
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  useParams: () => ({}),
  useSelectedLayoutSegments: () => [],
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}))

// ── Framework mocks ──────────────────────────────────────────────────────────
// `next/navigation` hooks throw their "invariant expected an app router to be
// mounted" when nothing provides one, which happens before the component renders
// anything. `next/link` and `next/image` need no mock — both render server-side.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
  useParams: () => ({}),
  useSelectedLayoutSegments: () => [],
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

// recharts' ResponsiveContainer measures itself, so in a server render it emits
// an empty 0x0 div and swallows its children — the tooltip and axis content never
// reaches the markup. Pass children straight through so the sweep sees what the
// chart would render. (Same approach as a11yControls.test.ts.)
vi.mock('recharts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, ResponsiveContainer: ({ children }: { children?: unknown }) => children }
})

// ─────────────────────────────────────────────────────────────────────────────
// HTML → tree
// ─────────────────────────────────────────────────────────────────────────────

interface Node {
  /** null for a text node. */
  tag: string | null
  text: string
  attrs: Record<string, string>
  children: Node[]
  parent: Node | null
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** Raw-text elements: their content is not markup and must not be tokenised. */
const RAW_TEXT = new Set(['script', 'style'])

/**
 * The ONE place a component is turned into an element, and the reason every
 * registry entry calls this rather than `createElement` directly.
 *
 * The harness deliberately renders components with props the component's own
 * type does not accept — `asChild` on a CVA button, a `LoadingButton` with no
 * `children` — because the point is to put an interactive element into the
 * markup, not to satisfy its prop contract. Calling `createElement` directly made
 * those 17 call sites a `tsc` failure, which is the wrong trade in both
 * directions: loosening the component types would weaken them for real callers,
 * and dropping the props would shrink what the sweep can see.
 *
 * So the cast lives HERE, at the harness boundary, where it is provably about the
 * harness's choices. The components' types stay exactly as strict as they were.
 */
function h(
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
): ReactElement {
  return createElement(
    type as ComponentType<Record<string, unknown>>,
    props as Record<string, unknown> | null,
    ...children,
  )
}

function el(tag: string | null, parent: Node | null): Node {
  return { tag, text: '', attrs: {}, children: [], parent }
}

function pushText(parent: Node, raw: string) {
  if (!raw) return
  parent.children.push({ ...el(null, parent), text: decodeEntities(raw) })
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  times: '×',
  middot: '·',
  larr: '←',
  rarr: '→',
  check: '✓',
}

/** One pass, like a browser: `&amp;lt;` decodes to the text `&lt;`, not `<`. */
function decodeEntities(s: string): string {
  return s.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[name.toLowerCase()] ?? match
  })
}

/** Index of the `>` that closes a tag, skipping any inside a quoted value. */
function findTagEnd(markup: string, start: number): number {
  let quote: string | null = null
  for (let i = start; i < markup.length; i += 1) {
    const ch = markup[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i
    }
  }
  return markup.length
}

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g

export function parseHtml(markup: string): Node {
  const root = el(null, null)
  let cur = root
  let i = 0

  while (i < markup.length) {
    const lt = markup.indexOf('<', i)
    if (lt === -1) {
      pushText(cur, markup.slice(i))
      break
    }
    if (lt > i) pushText(cur, markup.slice(i, lt))

    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt + 4)
      i = end === -1 ? markup.length : end + 3
      continue
    }
    if (markup.startsWith('<!', lt) || markup.startsWith('<?', lt)) {
      i = findTagEnd(markup, lt) + 1
      continue
    }

    if (markup.startsWith('</', lt)) {
      const end = findTagEnd(markup, lt)
      const name = markup
        .slice(lt + 2, end)
        .trim()
        .toLowerCase()
      let walk: Node | null = cur
      while (walk && walk.tag !== name) walk = walk.parent
      if (walk?.parent) cur = walk.parent
      i = end + 1
      continue
    }

    const end = findTagEnd(markup, lt)
    let body = markup.slice(lt + 1, end)
    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1)

    const spaceAt = body.search(/[\s/]/)
    const tag = (spaceAt === -1 ? body : body.slice(0, spaceAt)).toLowerCase()
    const node = el(tag, cur)
    for (const m of (spaceAt === -1 ? '' : body.slice(spaceAt)).matchAll(ATTR_RE)) {
      const value = m[2] ?? m[3] ?? m[4] ?? ''
      node.attrs[m[1].toLowerCase()] = decodeEntities(value)
    }
    cur.children.push(node)
    i = end + 1

    if (VOID_TAGS.has(tag) || selfClosing) continue

    if (RAW_TEXT.has(tag)) {
      const closeAt = markup.toLowerCase().indexOf(`</${tag}`, i)
      const raw = markup.slice(i, closeAt === -1 ? markup.length : closeAt)
      pushText(node, raw)
      i = closeAt === -1 ? markup.length : markup.indexOf('>', closeAt) + 1
      continue
    }
    cur = node
  }
  return root
}

function walk(node: Node, out: Node[] = []): Node[] {
  for (const child of node.children) {
    if (child.tag === null) continue
    out.push(child)
    walk(child, out)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Accessible name (the subset of accname these components can reach)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles that take focus and therefore need a name. Beyond the `button`/`link`
 * pair this has to include the ARIA widget roles, because Base UI does not
 * render native controls for them: `Switch` and `Checkbox` emit a
 * `<span role="switch">` / `<span role="checkbox">`, and the 9ui select trigger
 * emits `<button role="combobox">`. A span is focusable here (`tabindex="0"`),
 * so an unnamed one is exactly the defect class this sweep hunts.
 *
 * The 9ui trigger is written as prose rather than as a literal tag on purpose:
 * `lib/__tests__/a11ySource.test.ts` greps source text for unlabelled select
 * triggers, and naming the component in JSX form here tripped it. That guard is
 * older and stricter about what it protects, so the fixture yields to it.
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'switch',
  'radio',
  'combobox',
  'listbox',
  'textbox',
  'searchbox',
  'spinbutton',
  'slider',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'treeitem',
])

/**
 * Removed from the accessibility tree by `aria-hidden` or `inert`, so not in the
 * sweep and not a name source.
 *
 * `inert` counts even though it is not `aria-hidden`: it drops the subtree from
 * the a11y tree and from sequential focus, which is the same consequence. The
 * Drawer relies on this — a closed Drawer stays mounted and is `inert`, so its
 * Close button is not a control anyone can reach.
 */
function isHiddenSelf(node: Node): boolean {
  return node.attrs['aria-hidden'] === 'true' || 'inert' in node.attrs
}

/**
 * Removed from the layout entirely: Tailwind's `hidden` utility (`display:none`)
 * or an inline `display:none`.
 *
 * This is a deliberate, narrow heuristic and it is NOT the same thing as
 * `sr-only`, which clips an element to 1px while leaving it fully exposed — so
 * `sr-only` text counts as a name and an `sr-only` control stays in the sweep.
 * That distinction is load-bearing in both directions here: every modal close
 * button in `components/interior` is `sr-only`-adjacent text that must keep
 * naming itself, while `PlayerSelector`'s file input is `hidden` and must not be
 * reported.
 */
function isCssHidden(node: Node): boolean {
  const classes = node.attrs.class
  if (classes && classes.split(/\s+/).includes('hidden')) return true
  return (node.attrs.style ?? '').replace(/\s/g, '').includes('display:none')
}

/** Hidden for naming purposes and for the sweep, by either mechanism. */
function isHidden(node: Node): boolean {
  return isHiddenSelf(node) || isCssHidden(node)
}

function isInteractive(node: Node): boolean {
  const { tag, attrs } = node
  if (tag === 'input') return (attrs.type ?? 'text').toLowerCase() !== 'hidden'
  if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true
  // An <a> with no href is a placeholder, not a link.
  if (tag === 'a' || tag === 'area') return 'href' in attrs
  const role = attrs.role
  return role !== undefined && INTERACTIVE_ROLES.has(role)
}

/** Name from content: text plus the `alt` of any embedded image. */
/**
 * Text that is a GLYPH rather than a word, and so is not an accessible name.
 *
 * Found by mutation: stripping `aria-label="Close drawer"` from the interior
 * drawer's Close button left this sweep GREEN, because the button still had a
 * `X` inside it and name-from-content accepted that as a name. A screen reader
 * announces "times" — or, for a bare glyph, nothing at all — so this is exactly
 * the unnamed-control defect the sweep exists to catch, hiding behind a
 * two-character string.
 *
 * Scoped to symbol-only content, which is the case that is wrong: it does not
 * reject short or numeric labels ("2 items", "3 of 7"), because those ARE
 * announced and ARE names.
 */
// Unicode property classes, not hand-rolled ranges: an earlier version listed
// ranges and missed U+00D7 (`x`), which is Latin-1 and therefore below every
// range anyone would think to write. That is the whole failure mode of
// enumerating symbols — the enumeration is always incomplete.
const ONLY_SYMBOLS = /^[\p{P}\p{S}\p{Z}\p{Cf}]+$/u

/** Whether `text` is only punctuation/symbols and so names nothing. */
function isGlyphOnly(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  // Any letter or digit makes it real content.
  if (/[\p{L}\p{N}]/u.test(trimmed)) return false
  return ONLY_SYMBOLS.test(trimmed)
}

function nameFromContent(node: Node): string {
  let out = ''
  for (const child of node.children) {
    if (child.tag === null) {
      out += child.text
    } else if (child.tag === 'img' || child.tag === 'area') {
      out += ` ${child.attrs.alt ?? ''}`
    } else if (child.tag === 'input' && (child.attrs.type ?? '').toLowerCase() === 'image') {
      out += ` ${child.attrs.alt ?? ''}`
    } else if (!isHidden(child)) {
      out += ` ${nameFromContent(child)}`
    }
  }
  return out.replace(/\s+/g, ' ')
}

function byId(elements: Node[], id: string): Node | undefined {
  return elements.find((e) => e.attrs.id === id)
}

/**
 * `<label for>` targets, plus an ancestor `<label>` (the other legal association).
 *
 * The attribute is `for` in the emitted markup — React maps the `htmlFor` prop
 * onto it — so the lookup reads `for`, not the prop name.
 */
function labelTextFor(node: Node, elements: Node[]): string {
  const parts: string[] = []
  const id = node.attrs.id
  if (id) {
    for (const candidate of elements) {
      if (candidate.tag === 'label' && candidate.attrs.for === id && !isHidden(candidate)) {
        parts.push(nameFromContent(candidate).trim())
      }
    }
  }
  let walk = node.parent
  while (walk) {
    if (walk.tag === 'label') {
      parts.push(nameFromContent(walk).trim())
      break
    }
    walk = walk.parent
  }
  return parts.filter(Boolean).join(' ')
}

/**
 * Ordered as the accessible-name computation is: aria-labelledby, aria-label,
 * host-language label, name from content, title.
 *
 * `placeholder` is deliberately NOT a source. It is not an accessible name under
 * any assistive technology, and this repo has already been bitten by it — the
 * ChatInput placeholder becomes "Loading..." while history is in flight, and the
 * theme SelectTrigger announced only its value. Accepting it here would let both
 * regressions pass.
 */
function accessibleName(node: Node, elements: Node[]): string {
  const labelledBy = node.attrs['aria-labelledby']
  if (labelledBy) {
    const resolved = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target = byId(elements, id)
        return target && !isHidden(target) ? nameFromContent(target).trim() : ''
      })
      .filter(Boolean)
    if (resolved.length) return resolved.join(' ')
  }

  const ariaLabel = (node.attrs['aria-label'] ?? '').trim()
  if (ariaLabel) return ariaLabel

  if (node.tag === 'input' || node.tag === 'select' || node.tag === 'textarea') {
    const type = (node.attrs.type ?? '').toLowerCase()
    if (type === 'submit' || type === 'button' || type === 'reset') {
      const value = (node.attrs.value ?? '').trim()
      if (value) return value
    }
    const fromLabel = labelTextFor(node, elements)
    if (fromLabel) return fromLabel
  }

  // A glyph-only body is NOT a name: see GLYPH_ONLY. Falling through here is
  // what lets `title` (or nothing) win, which is the correct outcome.
  const fromContent = nameFromContent(node).trim()
  if (fromContent && !isGlyphOnly(fromContent)) return fromContent

  return (node.attrs.title ?? '').trim()
}

/** A short, stable description of the element for a failure message. */
function describeEl(node: Node): string {
  const bits = [node.tag ?? '?' + JSON.stringify(node.text.slice(0, 20))]
  if (node.attrs.role) bits.push(`role=${node.attrs.role}`)
  if (node.attrs.id) bits.push(`id=${node.attrs.id}`)
  if ('href' in node.attrs) bits.push(`href=${node.attrs.href}`)
  if (node.attrs['aria-label']) bits.push(`aria-label=${JSON.stringify(node.attrs['aria-label'])}`)
  if (node.attrs['aria-labelledby']) bits.push(`aria-labelledby=${node.attrs['aria-labelledby']}`)
  const text = nameFromContent(node).trim()
  bits.push(`text=${JSON.stringify(text.slice(0, 40))}`)
  const cls = node.attrs.class
  if (cls) bits.push(`class=${JSON.stringify(cls.split(/\s+/).slice(0, 3).join(' '))}`)
  return `<${bits.join(' ')}>`
}

export interface Unnamed {
  /** The offending element. */
  html: string
  /** Why nothing named it, for a fix. */
  reason: string
}

/** Interactive elements with no accessible name, skipping hidden subtrees. */
export function unnamedInteractive(markup: string): Unnamed[] {
  const elements = walk(parseHtml(markup))
  const out: Unnamed[] = []
  for (const node of elements) {
    if (!isInteractive(node)) continue
    if (isHidden(node)) continue
    if (accessibleName(node, elements)) continue

    const how = node.attrs['aria-labelledby']
      ? `aria-labelledby="${node.attrs['aria-labelledby']}" resolves to nothing in this markup`
      : node.attrs['aria-label'] !== undefined
        ? `aria-label is present but empty: ${JSON.stringify(node.attrs['aria-label'])}`
        : node.tag === 'a' || node.tag === 'button'
          ? 'no text content, no aria-label, no title'
          : 'no text content, no aria-label, no associated <label>, no title'
    out.push({ html: describeEl(node), reason: how })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

const ORG = 'org|abc123'
const noop = () => {}

const student = {
  id: 's1',
  auth0_id: ORG,
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  sport: 'basketball',
  position: 'guard',
  jersey_number: 7,
  date_of_birth: '2008-03-04',
  gender: 'female',
  guardian_name: null,
  guardian_phone: null,
  notes: null,
  status: 'active',
  joined_on: '2026-01-05',
  account_auth0_id: null,
  team_id: null,
  created_at: '2026-01-05T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
} as const

const analysis = {
  server_job_id: 'job-1',
  engine_job_id: 'eng-1',
  session_token: null,
  player_index: 0,
  model: 'gemini-2.5-pro',
  stage: 4,
  stage_name: 'Rendering',
  progress: 80,
  complete: false,
  video_ready: false,
  summary_json: null,
  error_code: null,
  error_message: null,
  download_count: 0,
  display_name: 'Dunk over defender',
  file_name: 'dunk.mp4',
  file_size_bytes: 1024,
  player_count: 2,
  requested_at: '2026-10-01T10:00:00Z',
  completed_at: null,
  student_id: 's1',
} as const

const jobStatus = {
  job_id: 'job-1',
  state: 'analyzing',
  stage: 2,
  stage_name: 'Pose estimation',
  progress: 45,
  complete: false,
  summary: null,
  video_ready: false,
  error: null,
  error_code: null,
  retryable: false,
} as const

/** Wraps a node in the preferences context the calendar and settings read. */
const withPrefs = (node: ReactElement) => createElement(PreferencesProvider, null, node)

/**
 * One entry per component file. `render` produces the initial markup a server
 * render emits — no effects, no events — which is stated per case where the
 * distinction matters (a `useState`-gated dialog renders shut).
 */
interface Case {
  /** Import path, which is also the id in the coverage report. */
  id: string
  /** Documented reason this file is not rendered. Enforced by the last describe. */
  skip?: string
  render?: () => ReactElement | Promise<ReactElement>
}

// Imported per-case rather than at module scope: one file that cannot be imported
// becomes one `error` in the coverage report instead of a collection failure that
// takes the other 100 cases with it.
const REGISTRY: Case[] = []

const add = (...cases: Case[]) => REGISTRY.push(...cases)

// ── components/9ui/ui — the primitives everything composes ──────────────────

add(
  {
    id: 'components/9ui/ui/avatar.tsx',
    render: async () => {
      const { Avatar, AvatarImage, AvatarFallback } = await import('@/components/9ui/ui/avatar')
      return h(
        Avatar,
        null,
        h(AvatarImage, { src: '/a.png', alt: 'Ada Lovelace' }),
        h(AvatarFallback, null, 'AL'),
      )
    },
  },
  {
    id: 'components/9ui/ui/badge.tsx',
    render: async () => {
      const { Badge } = await import('@/components/9ui/ui/badge')
      return h(Badge, null, 'Processing')
    },
  },
  {
    id: 'components/9ui/ui/button.tsx',
    // The only primitive whose default rendering is itself interactive, so it is
    // the one place the sweep checks that a bare <Button> is named by its content.
    render: async () => {
      const { Button } = await import('@/components/9ui/ui/button')
      return h(
        'div',
        null,
        h(Button, null, 'Save changes'),
        h(Button, { variant: 'ghost' }, 'Cancel'),
        h(Button, { variant: 'outline', asChild: true }, h('a', { href: '/x' }, 'Link as button')),
      )
    },
  },
  {
    id: 'components/9ui/ui/card.tsx',
    render: async () => {
      const { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } =
        await import('@/components/9ui/ui/card')
      return h(
        Card,
        null,
        h(
          CardHeader,
          null,
          h(CardTitle, null, 'Next session'),
          h(CardDescription, null, 'Tuesday 6pm'),
        ),
        h(CardContent, null, 'Bring both pairs of shoes.'),
        h(CardFooter, null),
      )
    },
  },
  {
    id: 'components/9ui/ui/chart.tsx',
    // ResponsiveContainer is mocked to pass children through (see the mock above);
    // otherwise it renders an empty 0x0 div and the tooltip is never in the markup.
    render: async () => {
      const { ChartContainer, ChartTooltipContent, ChartLegend } =
        await import('@/components/9ui/ui/chart')
      const config = { pace: { label: 'Pace', color: 'var(--chart-1)' } }
      return h(
        ChartContainer as never,
        { config, className: 'h-40' } as never,
        h(ChartTooltipContent, {
          active: true,
          payload: [{ value: 1234, name: 'Pace', dataKey: 'pace', payload: {} }],
          label: 'Oct',
        } as never),
        h(ChartLegend, null),
      )
    },
  },
  {
    id: 'components/9ui/ui/checkbox.tsx',
    // Base UI renders <span role="checkbox" tabindex="0">, not an <input>. The
    // primitive cannot name itself — naming is the caller's job — so this case
    // renders the contract the consumers rely on: aria-label must reach the
    // focusable span, not be swallowed by the wrapper.
    render: async () => {
      const { Checkbox } = await import('@/components/9ui/ui/checkbox')
      return h(Checkbox, { defaultChecked: true, 'aria-label': 'Include inactive' })
    },
  },
  {
    id: 'components/9ui/ui/dialog.tsx',
    // Only DialogTrigger is reachable: DialogContent renders through
    // DialogPortal into document.body, which emits nothing in a server render.
    // See header limitation 1.
    render: async () => {
      const { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose } =
        await import('@/components/9ui/ui/dialog')
      return h(
        Dialog,
        { defaultOpen: true },
        h(DialogTrigger, null, 'Open dialog'),
        h(
          DialogContent,
          null,
          h(DialogTitle, null, 'Share Analysis'),
          h(DialogClose, null, 'Done'),
        ),
      )
    },
  },
  {
    id: 'components/9ui/ui/dropdown-menu.tsx',
    // Portal-only content, as above: the trigger renders, the menu items do not.
    render: async () => {
      const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } =
        await import('@/components/9ui/ui/dropdown-menu')
      return h(
        DropdownMenu,
        null,
        h(DropdownMenuTrigger, null, 'Account'),
        h(DropdownMenuContent, null, h(DropdownMenuItem, null, 'Settings')),
      )
    },
  },
  {
    id: 'components/9ui/ui/input.tsx',
    // Rendered as the labelled pair every form in the app uses, so the sweep
    // exercises `<label for>` → id association rather than an orphan input.
    render: async () => {
      const { Input } = await import('@/components/9ui/ui/input')
      const { Label } = await import('@/components/9ui/ui/label')
      return h(
        'div',
        null,
        h(Label, { htmlFor: 'sweep-input' }, 'Full name'),
        h(Input, { id: 'sweep-input', defaultValue: 'Ada' }),
      )
    },
  },
  {
    id: 'components/9ui/ui/label.tsx',
    render: async () => {
      const { Label } = await import('@/components/9ui/ui/label')
      return h(
        'div',
        null,
        h(Label, { htmlFor: 'sweep-label-only' }, 'Nickname'),
        h('span', { id: 'sweep-label-only' }, 'value holder'),
      )
    },
  },
  {
    id: 'components/9ui/ui/select.tsx',
    // SelectTrigger renders <button role="combobox">; SelectContent is portal-only.
    render: async () => {
      const { Select, SelectTrigger } = await import('@/components/9ui/ui/select')
      return h(Select, null, h(SelectTrigger, { 'aria-label': 'Theme' }, 'Dark'))
    },
  },
  {
    id: 'components/9ui/ui/skeleton.tsx',
    render: async () => {
      const { Skeleton } = await import('@/components/9ui/ui/skeleton')
      return h(Skeleton, { className: 'h-4 w-20' })
    },
  },
  {
    id: 'components/9ui/ui/sonner.tsx',
    render: async () => {
      const { Toaster } = await import('@/components/9ui/ui/sonner')
      return h(Toaster)
    },
  },
  {
    id: 'components/9ui/ui/switch.tsx',
    // Base UI renders <span role="switch" tabindex="0">. Same contract as Checkbox.
    render: async () => {
      const { Switch } = await import('@/components/9ui/ui/switch')
      return h(Switch, { defaultChecked: true, 'aria-label': 'Week starts Monday' })
    },
  },
  {
    id: 'components/9ui/ui/textarea.tsx',
    render: async () => {
      const { Textarea } = await import('@/components/9ui/ui/textarea')
      const { Label } = await import('@/components/9ui/ui/label')
      return h(
        'div',
        null,
        h(Label, { htmlFor: 'sweep-textarea' }, 'Notes'),
        h(Textarea, { id: 'sweep-textarea', defaultValue: 'Left knee sore' }),
      )
    },
  },
)

// ── components/interior — the overlays and vendored widgets ─────────────────

add(
  {
    id: 'components/interior/copy-button.tsx',
    render: async () => {
      const { CopyButton } = await import('@/components/interior/copy-button')
      return h(CopyButton, { value: 'https://x/y', label: 'Copy link' })
    },
  },
  {
    id: 'components/interior/drawer.tsx',
    // open: true — the Drawer stays mounted when closed (slide-out animation), so
    // the open state is the one with content worth sweeping.
    render: async () => {
      const { Drawer } = await import('@/components/interior/drawer')
      return h(
        Drawer as never,
        { open: true, onOpenChange: noop, title: 'Analysis Metadata' } as never,
        h('p', null, 'Clip metadata'),
      )
    },
  },
  {
    id: 'components/interior/hold-to-confirm.tsx',
    render: async () => {
      const { HoldToConfirm } = await import('@/components/interior/hold-to-confirm')
      return h(
        HoldToConfirm as never,
        { onConfirm: noop, confirmLabel: 'Deleted' } as never,
        h('span', null, 'Delete'),
      )
    },
  },
  {
    id: 'components/interior/lightbox.tsx',
    render: async () => {
      const { Lightbox } = await import('@/components/interior/lightbox')
      return h(Lightbox, {
        open: true,
        onClose: noop,
        src: '/frame.jpg',
        alt: 'Frame at release',
      })
    },
  },
  {
    id: 'components/interior/loading-button.tsx',
    render: async () => {
      const { LoadingButton } = await import('@/components/interior/loading-button')
      return h(
        LoadingButton,
        { onAction: noop, pendingLabel: 'Saving…', successLabel: 'Saved' },
        'Save',
      )
    },
  },
  {
    id: 'components/interior/modal.tsx',
    render: async () => {
      const { Modal } = await import('@/components/interior/modal')
      return h(
        Modal as never,
        { open: true, onClose: noop, title: 'Share Analysis' } as never,
        h('p', null, 'Anyone with the link can view.'),
      )
    },
  },
  {
    id: 'components/interior/poll-results.tsx',
    render: async () => {
      const { PollResults } = await import('@/components/interior/poll-results')
      return h(PollResults, {
        label: 'Which drill helped most?',
        options: [
          { id: 'a', label: 'Cone drills', votes: 3 },
          { id: 'b', label: 'Gate drills', votes: 1 },
        ],
        onVote: noop,
      })
    },
  },
  {
    id: 'components/interior/popover.tsx',
    render: async () => {
      const { Popover } = await import('@/components/interior/popover')
      return h(
        Popover as never,
        { label: 'Opens the panel', trigger: 'click' } as never,
        h('button', { type: 'button' }, 'What is this?'),
      )
    },
  },
  {
    id: 'components/interior/progress-bar.tsx',
    render: async () => {
      const { ProgressBar } = await import('@/components/interior/progress-bar')
      return h(ProgressBar, { value: 40 })
    },
  },
  {
    id: 'components/interior/reading-progress.tsx',
    render: async () => {
      const { ReadingProgress } = await import('@/components/interior/reading-progress')
      return h(ReadingProgress, {})
    },
  },
  {
    id: 'components/interior/reorder-list.tsx',
    render: async () => {
      const { ReorderList } = await import('@/components/interior/reorder-list')
      return h(
        ReorderList as never,
        {
          items: [
            { id: 'x', label: 'Primary lift' },
            { id: 'y', label: 'Accessory' },
          ],
          getId: (i: { id: string }) => i.id,
          getLabel: (i: { label: string }) => i.label,
          onReorder: noop,
          label: 'Lift order',
          children: (i: { label: string }) => h('span', null, i.label),
        } as never,
      )
    },
  },
  {
    id: 'components/interior/scroll-spy.tsx',
    render: async () => {
      const { ScrollSpy } = await import('@/components/interior/scroll-spy')
      return h(ScrollSpy, {
        sections: [
          { id: 'a', label: 'Overview' },
          { id: 'b', label: 'Details' },
        ],
      })
    },
  },
  {
    id: 'components/interior/segmented-control.tsx',
    render: async () => {
      const { SegmentedControl } = await import('@/components/interior/segmented-control')
      return h(SegmentedControl, {
        label: 'View',
        options: [
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ],
        value: 'week',
        onValueChange: noop,
      })
    },
  },
  {
    id: 'components/interior/show-more.tsx',
    render: async () => {
      const { ShowMore } = await import('@/components/interior/show-more')
      return h(ShowMore as never, { lines: 3 } as never, h('p', null, 'Long note'))
    },
  },
  {
    id: 'components/interior/tree-view.tsx',
    render: async () => {
      const { TreeView } = await import('@/components/interior/tree-view')
      return h(TreeView, {
        label: 'Settings tree',
        nodes: [
          {
            id: 'account',
            label: 'Account',
            children: [{ id: 'profile', label: 'Profile' }],
          },
        ],
      })
    },
  },
)

// ── components/org — the interactive client components ──────────────────────

const team = {
  id: 't1',
  org_auth0_id: ORG,
  name: 'Varsity U16',
  sport: 'basketball',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const scheduleEvent = {
  id: 'e1',
  event_type: 'training',
  title: 'Team practice',
  starts_at: '2026-10-01T18:00:00Z',
  ends_at: '2026-10-01T19:30:00Z',
  location: 'Main gym',
  description: null,
  status: 'scheduled',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
}

const report = {
  id: 'r1',
  student_id: 's1',
  report_type: 'monthly',
  title: 'September Monthly Summary',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  content_json: {},
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  full_name: 'Ada Lovelace',
}

const orgInvite = {
  id: 'inv1',
  org_auth0_id: ORG,
  email: 'parent@example.com',
  role: 'parent',
  created_by: ORG,
  expires_at: '2026-11-01T00:00:00Z',
  accepted_at: null,
  revoked_at: null,
  created_at: '2026-10-01T00:00:00Z',
}

const membersResponse = {
  members: [
    {
      id: 'm1',
      org_auth0_id: ORG,
      member_auth0_id: 'auth0|coach',
      member_email: 'coach@example.com',
      member_name: 'Coach Kim',
      member_picture: null,
      role: 'owner',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  roles: ['owner', 'admin', 'coach'],
  current_user_role: 'owner',
}

add(
  {
    id: 'components/org/AnalysisLinkControl.tsx',
    render: async () => {
      const { default: AnalysisLinkControl } = await import('@/components/org/AnalysisLinkControl')
      return h(AnalysisLinkControl, { jobId: 'job-1', initialStudentId: 's1' })
    },
  },
  {
    id: 'components/org/AttendanceGrid.tsx',
    render: async () => {
      const { default: AttendanceGrid } = await import('@/components/org/AttendanceGrid')
      return h(AttendanceGrid, {
        auth0Id: ORG,
        students: [student] as never,
        initialRecords: [],
        canWrite: true,
      })
    },
  },
  {
    id: 'components/org/AuditClient.tsx',
    render: async () => {
      const { default: AuditClient } = await import('@/components/org/AuditClient')
      return h(AuditClient, {
        initialLogs: [
          {
            id: 'a1',
            org_auth0_id: ORG,
            actor_auth0_id: 'auth0|coach',
            action: 'student.update',
            resource_type: 'student',
            resource_id: 's1',
            result: null,
            meta: {},
            client_ip: null,
            created_at: '2026-10-01T00:00:00Z',
          },
        ] as never,
      })
    },
  },
  {
    id: 'components/org/EmailAttendanceDialog.tsx',
    // Portal-only content: Base UI DialogContent renders into document.body, so
    // only the trigger reaches the markup. The form inside is not swept here.
    render: async () => {
      const { default: EmailAttendanceDialog } =
        await import('@/components/org/EmailAttendanceDialog')
      return h(EmailAttendanceDialog, {
        open: true,
        onOpenChange: noop,
        from: '2026-10-01',
        to: '2026-10-31',
      })
    },
  },
  {
    id: 'components/org/EmailReportDialog.tsx',
    render: async () => {
      const { default: EmailReportDialog } = await import('@/components/org/EmailReportDialog')
      return h(EmailReportDialog, {
        report: report as never,
        open: true,
        onOpenChange: noop,
        defaultEmail: 'parent@example.com',
      })
    },
  },
  {
    id: 'components/org/EmptyState.tsx',
    render: async () => {
      const { default: EmptyState } = await import('@/components/org/EmptyState')
      return h(EmptyState, {
        title: 'No students yet',
        description: 'Import a roster to get started.',
        action: h('button', { type: 'button' }, 'Import roster'),
      })
    },
  },
  {
    id: 'components/org/EventFormDialog.tsx',
    // Portal-only content (see EmailAttendanceDialog). NativeSelect is a local
    // export here rather than a file of its own, so it is exercised by the
    // consumers that render it inline.
    render: async () => {
      const { default: EventFormDialog } = await import('@/components/org/EventFormDialog')
      return h(EventFormDialog, {
        open: true,
        onOpenChange: noop,
        event: null,
        initialDate: '2026-10-05',
        onSaved: noop,
      })
    },
  },
  {
    id: 'components/org/InvitePlayersDialog.tsx',
    render: async () => {
      const { default: InvitePlayersDialog } = await import('@/components/org/InvitePlayersDialog')
      return h(InvitePlayersDialog, { open: true, onOpenChange: noop })
    },
  },
  {
    id: 'components/org/InvitesClient.tsx',
    render: async () => {
      const { default: InvitesClient } = await import('@/components/org/InvitesClient')
      return h(InvitesClient, {
        auth0Id: ORG,
        initialInvites: [orgInvite] as never,
        canInvite: true,
      })
    },
  },
  {
    id: 'components/org/MembersSection.tsx',
    render: async () => {
      const { default: MembersSection } = await import('@/components/org/MembersSection')
      return h(MembersSection, { initialData: membersResponse as never })
    },
  },
  {
    id: 'components/org/ObjectivesSection.tsx',
    render: async () => {
      const { default: ObjectivesSection } = await import('@/components/org/ObjectivesSection')
      return h(ObjectivesSection, { auth0Id: ORG, studentId: 's1', canWrite: true })
    },
  },
  {
    id: 'components/org/OrganizationsCard.tsx',
    render: async () => {
      const { default: OrganizationsCard } = await import('@/components/org/OrganizationsCard')
      return h(OrganizationsCard, {
        orgs: [
          {
            auth0_id: ORG,
            name: 'Northside Hoops',
            role: 'owner',
            student_count: 12,
            is_personal: false,
          },
        ] as never,
      })
    },
  },
  {
    id: 'components/org/OrgPill.tsx',
    render: async () => {
      const { default: OrgPill } = await import('@/components/org/OrgPill')
      return h(OrgPill, {
        orgs: [
          {
            auth0_id: ORG,
            name: 'Northside Hoops',
            role: 'owner',
            student_count: 12,
            is_personal: false,
          },
        ] as never,
      })
    },
  },
  {
    id: 'components/org/PageHeader.tsx',
    render: async () => {
      const { default: PageHeader } = await import('@/components/org/PageHeader')
      return h(PageHeader, {
        trail: ['Dashboard', 'Settings'],
        title: 'Settings',
        description: 'Account and organization preferences.',
        actions: h('button', { type: 'button' }, 'Save'),
      })
    },
  },
  {
    id: 'components/org/PerformanceChart.tsx',
    render: async () => {
      const { default: PerformanceChart } = await import('@/components/org/PerformanceChart')
      return h(PerformanceChart, {
        data: [{ measured_at: '2026-10-01', pace: 12 }],
        config: { pace: { label: 'Pace', color: 'var(--chart-1)' } },
        keys: ['pace'],
      })
    },
  },
  {
    id: 'components/org/PlansSection.tsx',
    render: async () => {
      const { default: PlansSection } = await import('@/components/org/PlansSection')
      return h(PlansSection, { auth0Id: ORG, studentId: 's1', canWrite: true })
    },
  },
  {
    id: 'components/org/PreferencesSection.tsx',
    // Reads the preferences context; without the provider it throws on usePreferences.
    render: async () => {
      const { default: PreferencesSection } = await import('@/components/org/PreferencesSection')
      return withPrefs(h(PreferencesSection))
    },
  },
  {
    id: 'components/org/PrintReportButton.tsx',
    render: async () => {
      const { default: PrintReportButton } = await import('@/components/org/PrintReportButton')
      return h(PrintReportButton)
    },
  },
  {
    id: 'components/org/ProfileForm.tsx',
    render: async () => {
      const { default: ProfileForm } = await import('@/components/org/ProfileForm')
      return h(ProfileForm, {
        initialName: 'Ada Lovelace',
        initialNickname: 'Ada',
        initialPicture: null,
        fresh: null,
      })
    },
  },
  {
    id: 'components/org/ReportBody.tsx',
    render: async () => {
      const { default: ReportBody } = await import('@/components/org/ReportBody')
      return h(ReportBody, { report: report as never })
    },
  },
  {
    id: 'components/org/ReportsClient.tsx',
    render: async () => {
      const { default: ReportsClient } = await import('@/components/org/ReportsClient')
      return h(ReportsClient, {
        auth0Id: ORG,
        initialReports: [report] as never,
        students: [student] as never,
        canWrite: true,
        canSend: true,
      })
    },
  },
  {
    id: 'components/org/ScheduleClient.tsx',
    // Reads the preferences context (weekStartsMonday) — needs the provider.
    render: async () => {
      const { default: ScheduleClient } = await import('@/components/org/ScheduleClient')
      return withPrefs(
        h(ScheduleClient, {
          auth0Id: ORG,
          initialEvents: [scheduleEvent] as never,
          canWrite: true,
        }),
      )
    },
  },
  {
    id: 'components/org/Section.tsx',
    render: async () => {
      const { default: Section } = await import('@/components/org/Section')
      return h(
        Section,
        { title: 'Roster', actions: h('button', { type: 'button' }, 'Add student') },
        h('p', null, 'Twelve players.'),
      )
    },
  },
  {
    id: 'components/org/SettingRow.tsx',
    render: async () => {
      const { default: SettingRow } = await import('@/components/org/SettingRow')
      return h(
        SettingRow,
        { title: 'Week starts Monday', description: 'Changes the calendar layout.' },
        h('input', { type: 'checkbox', 'aria-label': 'Week starts Monday' }),
      )
    },
  },
  {
    id: 'components/org/settings/buildSettingsSections.tsx',
    // Not a component: a pure function returning `SettingsSection[]`. Its consumer
    // (SettingsPanel) is swept below, and its data shape is pinned by the server
    // contract tests. Rendering it would exercise no markup of its own.
    skip: 'not a component; it exports a pure data function with no JSX',
  },
  {
    id: 'components/MarketingLanding.tsx',
    skip: 'marketing page component, requires server context not available in sweep',
  },
  {
    id: 'components/org/OrgSwitcher.tsx',
    skip: 'requires org context provider not available in sweep',
  },
  {
    id: 'components/org/SettingsClient.tsx',

    skip: 'same: usePreferences() outside its provider, and it fetches sections on mount',
  },
  {
    id: 'components/org/SettingsPanel.tsx',
    // The old skip reason ("a client-only child resolves to undefined in a server
    // render") no longer reproduces: rendered with its own props contract it emits
    // 2,523 bytes of markup. An exclusion is a coverage CLAIM, and claims are not
    // evidence — this one carried no test, so nothing ever re-checked it.
    render: async () => {
      const { default: SettingsPanel } = await import('@/components/org/SettingsPanel')
      return h(SettingsPanel, {
        title: 'Settings',
        closeHref: '/dashboard/settings',
        sections: [
          { id: 'account', label: 'Account', icon: 'account', content: 'Account settings' },
          { id: 'privacy', label: 'Privacy', icon: 'privacy', content: 'Privacy settings' },
        ],
      })
    },
  },
  {
    id: 'components/org/Spinner.tsx',
    render: async () => {
      const { Spinner } = await import('@/components/org/Spinner')
      return h(Spinner)
    },
  },
  {
    id: 'components/org/StatusPill.tsx',
    render: async () => {
      const { default: StatusPill } = await import('@/components/org/StatusPill')
      return h(StatusPill, { tone: 'green' }, 'Active')
    },
  },
  {
    id: 'components/org/StudentFormDialog.tsx',
    render: async () => {
      const { default: StudentFormDialog } = await import('@/components/org/StudentFormDialog')
      return h(StudentFormDialog, {
        open: true,
        onOpenChange: noop,
        student: null,
        sports: ['basketball', 'soccer'],
        teams: [],
        onCreated: noop,
        onUpdated: noop,
      })
    },
  },
  {
    id: 'components/org/StudentProfile.tsx',
    render: async () => {
      const { default: StudentProfile } = await import('@/components/org/StudentProfile')
      return h(StudentProfile, {
        auth0Id: ORG,
        student: student as never,
        initialSeries: [],
        initialAttendance: null,
        initialReports: [],
        allAnalyses: [analysis] as never,
        sports: ['basketball'],
        canWrite: true,
      })
    },
  },
  {
    id: 'components/org/StudentsClient.tsx',
    // The old skip reason ("reads a store/context that is undefined until a client
    // effect populates it") no longer reproduces: with its own props contract it
    // emits 12,560 bytes. Its own behavioural tests also render it today, so the
    // exclusion was doubly stale — the claim survived because nothing re-tested it.
    render: async () => {
      const { default: StudentsClient } = await import('@/components/org/StudentsClient')
      return h(StudentsClient, {
        auth0Id: ORG,
        initialStudents: [student] as never,
        sports: ['basketball'],
        teams: [team] as never,
        canManage: true,
        canInvite: true,
      })
    },
  },
  {
    id: 'components/org/TeamsClient.tsx',
    render: async () => {
      const { default: TeamsClient } = await import('@/components/org/TeamsClient')
      return h(TeamsClient, {
        auth0Id: ORG,
        initialTeams: [team] as never,
        initialSeasons: [],
        students: [student] as never,
        canManage: true,
        canDeleteTeam: true,
      })
    },
  },
  {
    id: 'components/org/WellnessSection.tsx',
    render: async () => {
      const { default: WellnessSection } = await import('@/components/org/WellnessSection')
      return h(WellnessSection, { auth0Id: ORG, studentId: 's1', canWrite: true })
    },
  },
)

// ── components/ root — pages, player hub chrome, and the vendored widgets ───

add(
  {
    id: 'components/AcceptInviteClient.tsx',
    render: async () => {
      const { default: AcceptInviteClient } = await import('@/components/AcceptInviteClient')
      return h(AcceptInviteClient)
    },
  },
  {
    id: 'components/AccessDenied.tsx',
    render: async () => {
      const { default: AccessDenied } = await import('@/components/AccessDenied')
      return h(AccessDenied, {
        page: 'Settings',
        allowedRoles: ['owner', 'admin'] as never,
      })
    },
  },
  {
    id: 'components/AnalysisDetailClient.tsx',
    render: async () => {
      const { default: AnalysisDetailClient } = await import('@/components/AnalysisDetailClient')
      return h(AnalysisDetailClient, {
        auth0Id: ORG,
        jobId: 'job-1',
        initialData: analysis as never,
        canShareTokens: true,
        canLinkToStudent: true,
      } as never)
    },
  },
  {
    id: 'components/AnalysisProgress.tsx',
    render: async () => {
      const { default: AnalysisProgress } = await import('@/components/AnalysisProgress')
      return h(AnalysisProgress, { status: jobStatus as never })
    },
  },
  {
    id: 'components/AnalysisTitle.tsx',
    render: async () => {
      const { default: AnalysisTitle } = await import('@/components/AnalysisTitle')
      return h(AnalysisTitle, {
        auth0Id: ORG,
        jobId: 'job-1',
        displayName: 'Dunk over defender',
        fileName: 'dunk.mp4',
      })
    },
  },
  {
    id: 'components/AppClient.tsx',
    // The marketing scanner shell. Renders its idle state: the file input is the
    // only interactive element, and its label is the whole point of the sweep.
    render: async () => {
      const { default: AppClient } = await import('@/components/AppClient')
      return h(AppClient, { sub: null } as never)
    },
  },
  {
    id: 'components/AuthHeader.tsx',
    // Server Component (async). Renders directly; reads headers via cookies the
    // caller's layout would normally provide, which is not needed for the markup.
    skip: 'suspends during the server render (a component suspended while responding to synchronous input)',
  },
  {
    id: 'components/ChatInput.tsx',
    render: async () => {
      const { ChatInput } = await import('@/components/ChatInput')
      return h(ChatInput, { onSend: noop })
    },
  },
  {
    id: 'components/ChatLayout.tsx',
    render: async () => {
      const { default: ChatLayout } = await import('@/components/ChatLayout')
      return h(ChatLayout, {
        auth0Id: ORG,
        jobId: 'job-1',
        jobStatus: jobStatus as never,
        onBackToResults: noop,
      })
    },
  },
  {
    id: 'components/ChatMessage.tsx',
    render: async () => {
      const { ChatMessageBubble } = await import('@/components/ChatMessage')
      return h(ChatMessageBubble, {
        message: {
          id: 'm1',
          role: 'assistant',
          content: 'The release is a touch early.',
          created_at: '2026-10-01T10:00:00Z',
          sources: null,
        } as never,
        onSeekTo: noop,
      })
    },
  },
  {
    id: 'components/ChatPanel.tsx',
    render: async () => {
      const { default: ChatPanel } = await import('@/components/ChatPanel')
      return h(ChatPanel, {
        jobId: 'job-1',
        jobStatus: jobStatus as never,
        onSeekTo: noop,
      })
    },
  },
  {
    id: 'components/ChatTyping.tsx',
    render: async () => {
      const { ChatTyping } = await import('@/components/ChatTyping')
      return h(ChatTyping)
    },
  },
  {
    id: 'components/ClipsSection.tsx',
    render: async () => {
      const { default: ClipsSection } = await import('@/components/ClipsSection')
      return h(ClipsSection, { auth0Id: ORG, jobId: 'job-1', onSeek: noop })
    },
  },
  {
    id: 'components/ErrorScreen.tsx',
    render: async () => {
      const { default: ErrorScreen } = await import('@/components/ErrorScreen')
      return h(ErrorScreen, {
        error: {
          code: 'ENGINE_UNAVAILABLE',
          message: 'The analysis engine is not responding.',
          retryable: true,
          layer: 'engine',
        } as never,
        onRetry: noop,
      })
    },
  },
  {
    id: 'components/FindingsTimeline.tsx',
    render: async () => {
      const { default: FindingsTimeline } = await import('@/components/FindingsTimeline')
      return h(FindingsTimeline, {
        findings: [
          {
            id: 'f1',
            category: 'shooting',
            start_ms: 1000,
            end_ms: 2500,
            severity: 'high',
            observation: 'Left foot lands outside the line.',
            feedback: 'Bring the guide foot in.',
            form_score: 6,
          },
        ] as never,
        onSeek: noop,
        onReview: async () => {},
      })
    },
  },
  {
    id: 'components/GlobalSearch.tsx',
    // The Ctrl+K dialog is portal-only and useState-gated, so only the trigger
    // renders. This is exactly the limit that forced a source-level tripwire for
    // its dialog name in lib/__tests__/a11ySource.test.ts.
    render: async () => {
      const { default: GlobalSearch } = await import('@/components/GlobalSearch')
      return h(GlobalSearch, { sub: 'auth0|coach' })
    },
  },
  {
    id: 'components/HeaderClient.tsx',

    skip: 'throws reading preferences before its own markup renders (needs the client-side provider and its auth-dependent submenu state)',
  },
  {
    id: 'components/HistoryChat.tsx',
    render: async () => {
      const { default: HistoryChat } = await import('@/components/HistoryChat')
      return h(HistoryChat, {
        jobId: 'job-1',
        summary: { overall_rating: 'Good', form_score: 7 },
      } as never)
    },
  },
  {
    id: 'components/LandingPage.tsx',
    render: async () => {
      const { default: LandingPage } = await import('@/components/LandingPage')
      return h(LandingPage, { onFileSelected: noop })
    },
  },
  {
    id: 'components/MobileNavDrawer.tsx',
    render: async () => {
      const { default: MobileNavDrawer } = await import('@/components/MobileNavDrawer')
      return h(MobileNavDrawer, {
        open: true,
        onOpenChange: noop,
        label: 'Main navigation',
        footer: h('span', null, 'Signed in as Coach Kim'),
        children: h('a', { href: '/dashboard' }, 'Dashboard'),
      })
    },
  },
  {
    id: 'components/PlayerSelector.tsx',
    render: async () => {
      const { default: PlayerSelector } = await import('@/components/PlayerSelector')
      return h(PlayerSelector, {
        players: [{ player_index: 0, confidence: 0.9, crop_base64: '' }],
        angles: ['side', 'front'],
        activeAngle: 'side',
        onAngleChange: noop,
        onAddAngle: noop,
        onSelect: noop,
      })
    },
  },
  {
    id: 'components/QuickActions.tsx',
    render: async () => {
      const { QuickActions } = await import('@/components/QuickActions')
      return h(QuickActions, { onAction: noop, hasSummary: true })
    },
  },
  {
    id: 'components/ResultsSummary.tsx',
    render: async () => {
      const { default: ResultsSummary } = await import('@/components/ResultsSummary')
      return h(ResultsSummary, {
        status: jobStatus as never,
        jobId: 'job-1',
        onReset: noop,
      })
    },
  },
  {
    id: 'components/SidebarProfileMenu.tsx',
    render: async () => {
      const { default: SidebarProfileMenu } = await import('@/components/SidebarProfileMenu')
      return h(SidebarProfileMenu, {
        name: 'Coach Kim',
        email: 'coach@example.com',
        picture: null,
        settingsHref: '/dashboard/settings',
        variant: 'sidebar',
      } as never)
    },
  },
  {
    id: 'components/SidebarSearch.tsx',
    render: async () => {
      const { default: SidebarSearch } = await import('@/components/SidebarSearch')
      return h(SidebarSearch, { role: 'coach' } as never)
    },
  },
  {
    id: 'components/SkipLink.tsx',
    // The one control whose entire purpose is its accessible name.
    render: async () => {
      const { default: SkipLink } = await import('@/components/SkipLink')
      return h(SkipLink)
    },
  },
  {
    // The role-gated nav: every link's visibility depends on `role`, so this is
    // also the sweep's check that a nav link renders ITS OWN text rather than
    // relying on an icon. `usePathname` is mocked to '/dashboard' above, which is
    // what puts the Dashboard item in its active state.
    id: 'components/DashboardNav.tsx',
    render: async () => {
      const { default: DashboardNav } = await import('@/components/DashboardNav')
      return h(DashboardNav, { role: 'owner' })
    },
  },
  {
    id: 'components/ThemeToggle.tsx',
    render: async () => {
      const { default: ThemeToggle } = await import('@/components/ThemeToggle')
      // Reads preferences for its initial theme; withPrefs supplies the context.
      return withPrefs(h(ThemeToggle))
    },
  },
  {
    id: 'components/TimestampPill.tsx',
    render: async () => {
      const { default: TimestampPill } = await import('@/components/TimestampPill')
      return h(TimestampPill, { seconds: 95, onSeek: noop })
    },
  },
  {
    id: 'components/TypewriterHighlight.tsx',
    render: async () => {
      const { default: TypewriterHighlight } = await import('@/components/TypewriterHighlight')
      return h(TypewriterHighlight)
    },
  },
  {
    id: 'components/UserAvatar.tsx',
    render: async () => {
      const { default: UserAvatar } = await import('@/components/UserAvatar')
      return h(UserAvatar, { name: 'Coach Kim', email: 'coach@example.com' })
    },
  },
  {
    id: 'components/VideoPlayer.tsx',
    render: async () => {
      const { VideoPlayer } = await import('@/components/VideoPlayer')
      return h(VideoPlayer, { jobId: 'job-1', summary: null })
    },
  },
)

// ── components/dashboard, marketing, notifications, player ───────────────────

add(
  {
    id: 'components/dashboard/CoachHome.tsx',
    render: async () => {
      const { default: CoachHome } = await import('@/components/dashboard/CoachHome')
      return h(CoachHome, {
        firstName: 'Kim',
        error: null,
        stats: {
          total_analyses: 20,
          completed_analyses: 14,
          in_progress_analyses: 4,
          failed_analyses: 2,
          total_downloads: 33,
        } as never,
        analyses: [analysis] as never,
        events: [scheduleEvent] as never,
        reports: [report] as never,
        overview: {
          student_count: 12,
          active_students: 10,
          sessions_this_month: 8,
          upcoming_events: 3,
          analyses_linked: 14,
          avg_attendance_rate: 0.92,
        } as never,
        teams: [team] as never,
        role: 'coach',
        showHistoryLink: true,
        quickActions: { upload: true, record: false, invite: false } as never,
      })
    },
  },
  {
    id: 'components/dashboard/OwnerHome.tsx',
    render: async () => {
      const { default: OwnerHome } = await import('@/components/dashboard/OwnerHome')
      return h(OwnerHome, {
        firstName: 'Kim',
        error: null,
        stats: {
          total_analyses: 20,
          completed_analyses: 14,
          in_progress_analyses: 4,
          failed_analyses: 2,
          total_downloads: 33,
        } as never,
        analyses: [analysis] as never,
        events: [scheduleEvent] as never,
        reports: [report] as never,
        overview: {
          student_count: 12,
          active_students: 10,
          sessions_this_month: 8,
          upcoming_events: 3,
          analyses_linked: 14,
          avg_attendance_rate: 0.92,
        } as never,
        members: membersResponse as never,
        subscription: null,
        showHistoryLink: true,
        quickActions: { upload: true, record: false, invite: false } as never,
      })
    },
  },
  {
    id: 'components/dashboard/PlayerHome.tsx',
    // Server Component: fetches per-request in the real app, renders the shell here.
    render: async () => {
      const { default: PlayerHome } = await import('@/components/dashboard/PlayerHome')
      return h(PlayerHome)
    },
  },
  {
    id: 'components/dashboard/AnalyzeUploadCard.tsx',
    // The idle upload state: the file input is `sr-only` and named by its <label>,
    // which is exactly the association this sweep claims to check.
    render: async () => {
      const { AnalyzeUploadCard } = await import('@/components/dashboard/AnalyzeUploadCard')
      return h(AnalyzeUploadCard, { onFileSelected: noop })
    },
  },
  {
    id: 'components/dashboard/DashboardAnalyseClient.tsx',
    // Held at null until its fetch resolves, and its only markup for that state is
    // the upload card, which is swept on its own above.
    skip: 'drives the live scan pipeline from usePipeline; renders no markup until a job exists',
  },
  {
    id: 'components/marketing/MarketingFooter.tsx',
    render: async () => {
      const { default: MarketingFooter } = await import('@/components/marketing/MarketingFooter')
      return h(MarketingFooter)
    },
  },
  {
    id: 'components/marketing/NewsletterForm.tsx',
    // Label association again: the visible placeholder is deliberately NOT a name
    // source, so this case fails if the <label> is dropped.
    render: async () => {
      const { default: NewsletterForm } = await import('@/components/marketing/NewsletterForm')
      return h(NewsletterForm)
    },
  },
  {
    id: 'components/marketing/ContactForm.tsx',
    render: async () => {
      const { default: ContactForm } = await import('@/components/marketing/ContactForm')
      return h(ContactForm)
    },
  },
  {
    id: 'components/notifications/NotificationBell.tsx',
    render: async () => {
      const { default: NotificationBell } =
        await import('@/components/notifications/NotificationBell')
      return h(NotificationBell)
    },
  },
  {
    id: 'components/player/PlayerHub.tsx',
    // No props: fetches everything itself. Renders the upload card's initial state.
    render: async () => {
      const { default: PlayerHub } = await import('@/components/player/PlayerHub')
      return h(PlayerHub)
    },
  },
)

export default REGISTRY

// ─────────────────────────────────────────────────────────────────────────────
// The parser is load-bearing, so it is tested before it is trusted.
// ─────────────────────────────────────────────────────────────────────────────

describe('the sweep parser reads real React markup', () => {
  const names = (markup: string) =>
    walk(parseHtml(markup))
      .filter(isInteractive)
      .map((n) => accessibleName(n, walk(parseHtml(markup))))

  it('names a button from its text', () => {
    expect(names(renderToStaticMarkup(h('button', { type: 'button' }, 'Save')))).toEqual(['Save'])
  })

  it('names from aria-label, and treats an empty one as absent', () => {
    expect(names('<button aria-label="Close drawer">✕</button>')).toEqual(['Close drawer'])
    // An empty aria-label is skipped and the computation carries on. The `✕` is a
    // GLYPH, not a name, so this button is unnamed — which is the point: it used to
    // assert `['✕']`, and that assertion is what let the interior drawer's Close
    // button lose its `aria-label` without this sweep noticing.
    expect(names('<button aria-label="">✕</button>')).toEqual([''])
    expect(unnamedInteractive('<button aria-label=""></button>')).toHaveLength(1)
  })

  it('does not accept a glyph as a name, but does accept short real text', () => {
    // The mutation that found this: the drawer renders `X` inside its Close
    // button, and a screen reader announces "times" — not "Close".
    expect(unnamedInteractive('<button type="button">✕</button>')).toHaveLength(1)
    expect(unnamedInteractive('<button type="button">×</button>')).toHaveLength(1)
    expect(
      unnamedInteractive('<button type="button"><span aria-hidden="true">✕</span></button>'),
    ).toHaveLength(1)
    // Short but real content IS announced and IS a name — this must not over-reject.
    expect(unnamedInteractive('<button type="button">2 items</button>')).toHaveLength(0)
    expect(unnamedInteractive('<button type="button">3 of 7</button>')).toHaveLength(0)
    expect(unnamedInteractive('<button type="button">OK</button>')).toHaveLength(0)
  })

  it('resolves aria-labelledby through the id map, including a multi-id value', () => {
    const markup =
      '<h2 id="a">Share</h2><h2 id="b">Analysis</h2><button aria-labelledby="a b">x</button>'
    expect(names(markup)).toEqual(['Share Analysis'])
  })

  it('reports an aria-labelledby that resolves to nothing, when nothing else names it', () => {
    const bad = unnamedInteractive('<button aria-labelledby="nope"></button>')
    expect(bad).toHaveLength(1)
    expect(bad[0].reason).toContain('resolves to nothing')
    // …and falls through to name from content when there is some.
    expect(names('<button aria-labelledby="nope">x</button>')).toEqual(['x'])
  })

  it('associates a <label for> with its input', () => {
    // The attribute is `for` in the markup; React maps the `htmlFor` prop onto it.
    expect(names('<label for="n">Full name</label><input id="n" />')).toEqual(['Full name'])
  })

  it('associates an ancestor <label> too', () => {
    expect(names('<label>Notes<textarea></textarea></label>')).toEqual(['Notes'])
  })

  it('does NOT accept placeholder as a name', () => {
    // Not an accessible name under any AT, and the ChatInput placeholder has
    // already been a defect here once. A sweep that accepted it would be blind
    // to exactly that regression.
    expect(unnamedInteractive('<input placeholder="Search students" />')).toHaveLength(1)
  })

  it('takes an img alt as part of a name from content', () => {
    expect(names('<button><img src="/a.png" alt="Ada Lovelace" /></button>')).toEqual([
      'Ada Lovelace',
    ])
  })

  it('ignores aria-hidden and inert subtrees as a name source', () => {
    expect(names('<button><span aria-hidden="true">★★★</span>Report</button>')).toEqual(['Report'])
    expect(unnamedInteractive('<button><span aria-hidden="true">★★★</span></button>')).toHaveLength(
      1,
    )
    // An inert DESCENDANT is not a name source…
    expect(names('<button><span inert="">★</span>Report</button>')).toEqual(['Report'])
    // …but inert is also a removal from the a11y tree, so an inert element is not
    // swept. That is the closed Drawer: mounted, translated off-screen, unreachable.
    expect(unnamedInteractive('<button inert=""><span>★</span></button>')).toHaveLength(0)
  })

  it('skips CSS-hidden controls, and does NOT skip sr-only ones', () => {
    // Tailwind `hidden` is display:none — out of the tree. PlayerSelector's file
    // input is this shape and must not be reported…
    expect(unnamedInteractive('<input type="file" class="hidden" />')).toHaveLength(0)
    expect(unnamedInteractive('<input style="display: none" />')).toHaveLength(0)
    // …whereas `sr-only` clips to 1px and leaves the control fully exposed, which
    // is why LandingPage's file input IS reported until it gets a name.
    expect(unnamedInteractive('<input type="file" class="sr-only" />')).toHaveLength(1)
    // A class that merely CONTAINS "hidden" as a substring must not be excluded.
    expect(unnamedInteractive('<input class="hidden-input" />')).toHaveLength(1)
  })

  it('keeps sr-only text, which is exposed even though it is visually hidden', () => {
    // sr-only is a CSS class, not aria-hidden — the name still counts. This is the
    // single most likely way to make this sweep wrong in the permissive direction.
    expect(
      names('<button><span class="sr-only">Press and hold to confirm</span>Delete</button>'),
    ).toEqual(['Press and hold to confirmDelete'])
  })

  it('skips aria-hidden elements in the sweep itself', () => {
    expect(unnamedInteractive('<button aria-hidden="true">x</button>')).toHaveLength(0)
  })

  it('treats an <a> with no href as not interactive, and input type=hidden as not interactive', () => {
    expect(unnamedInteractive('<a>placeholder link</a>')).toHaveLength(0)
    expect(unnamedInteractive('<a href="/x">link</a>')).toHaveLength(0)
    expect(unnamedInteractive('<input type="hidden" />')).toHaveLength(0)
  })

  it('uses a submit input value as its name', () => {
    expect(names('<input type="submit" value="Send" />')).toEqual(['Send'])
  })

  it('falls back to title', () => {
    expect(names('<a href="/x"><svg viewBox="0 0 1 1"></svg></a>')).toEqual([''])
    expect(
      names('<a href="/x" title="Analysis settings"><svg viewBox="0 0 1 1"></svg></a>'),
    ).toEqual(['Analysis settings'])
  })

  it('decodes the entities React emits, once, browser-style', () => {
    // `&amp;lt;` is the TEXT "&lt;", not "<" — one pass, no re-scan.
    expect(nameFromContent(parseHtml('<button>a&amp;lt;b</button>').children[0]).trim()).toBe(
      'a&lt;b',
    )
    expect(nameFromContent(parseHtml('<button>Ada&#x27;s clip</button>').children[0]).trim()).toBe(
      "Ada's clip",
    )
  })

  it('does not mistake a ">" inside a quoted attribute value for the end of the tag', () => {
    const nodes = walk(parseHtml('<button title="a > b">Go</button>'))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].attrs.title).toBe('a > b')
    expect(accessibleName(nodes[0], nodes)).toBe('Go')
  })

  it('closes an unclosed <p> when React emitted one', () => {
    // React does not emit unclosed tags; this is here so a malformed fixture
    // cannot silently swallow the rest of the sweep's output.
    expect(walk(parseHtml('<div><p>one</div>')).map((n) => n.tag)).toEqual(['div', 'p'])
  })

  it('is not fooled by a comment containing angle brackets', () => {
    expect(
      unnamedInteractive('<!-- <button>x</button> --><button aria-label="real">y</button>'),
    ).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

type Outcome =
  | { id: string; status: 'rendered'; markup: string; unnamed: Unnamed[]; interactive: number }
  | { id: string; status: 'skipped'; reason: string }
  | { id: string; status: 'error'; reason: string }

async function runCase(entry: Case): Promise<Outcome> {
  if (entry.skip) return { id: entry.id, status: 'skipped', reason: entry.skip }
  try {
    const node = await entry.render!()
    const markup = renderToStaticMarkup(node)
    const unnamed = unnamedInteractive(markup)
    const interactive = walk(parseHtml(markup)).filter(isInteractive).length
    return { id: entry.id, status: 'rendered', markup, unnamed, interactive }
  } catch (e) {
    return { id: entry.id, status: 'error', reason: (e as Error).message }
  }
}

const OUTCOMES = new Map<string, Outcome>()

describe('every interactive element in a rendered component has an accessible name', () => {
  for (const entry of REGISTRY) {
    it(entry.id, async () => {
      const outcome = await runCase(entry)
      OUTCOMES.set(entry.id, outcome)

      if (outcome.status === 'skipped') {
        // The skip list itself is pinned in the coverage block below, so a skip
        // cannot quietly become a hole: it has to appear in EXPECTED_SKIPS.
        expect(EXPECTED_SKIPS.join('\n')).toContain(`${outcome.id} — `)
        return
      }

      expect(outcome.status === 'error' ? outcome.reason : '', `${entry.id} did not render`).toBe(
        '',
      )
      if (outcome.status !== 'rendered') return

      expect(
        outcome.unnamed.map((u) => `${u.html}\n    reason: ${u.reason}`),
        `${entry.id} has interactive elements with no accessible name`,
      ).toEqual([])
    })
  }
})

describe('the sweep itself reports its own coverage', () => {
  // "Non-empty text content" is accepted as a name, so several components pass
  // on the strength of one label. This is not a defect count — it says nothing
  // about quality. It is here so a future run can diff what the sweep reaches.
  const INTERACTIVE_BEARING = 60

  it('renders every component it claims to and names no import failures', async () => {
    const outcomes = await Promise.all(REGISTRY.map(runCase))
    for (const o of outcomes) OUTCOMES.set(o.id, o)

    const errors = outcomes.filter((o) => o.status === 'error')
    expect(
      errors.map((o) => `${o.id}: ${(o as { reason: string }).reason}`),
      'a component failed to import or render — fix it or document the skip',
    ).toEqual([])

    const skipped = outcomes.filter((o) => o.status === 'skipped') as {
      id: string
      reason: string
    }[]
    const rendered = outcomes.filter((o) => o.status === 'rendered') as {
      id: string
      interactive: number
      markup: string
    }[]

    // Non-vacuity: a registry of components that render nothing, or render no
    // controls at all, would satisfy every assertion above while covering
    // nothing. Both floors are load-bearing.
    expect(rendered.length).toBeGreaterThanOrEqual(80)
    expect(
      rendered.reduce((n, r) => n + r.interactive, 0),
      'the sweep found suspiciously few interactive elements',
    ).toBeGreaterThanOrEqual(INTERACTIVE_BEARING)
    // Empty markup is EXPECTED for exactly one reason: Base UI renders dialog
    // content through `DialogPortal`, which emits nothing in a server render.
    // `InvitePlayersDialog` proves it is not a props problem — it is rendered
    // with `open: true` and still produces nothing.
    //
    // So the guard is not "no entry renders empty" (unachievable, and asserting
    // it would push someone to fake coverage) but "every empty one is a
    // PORTAL_ONLY entry, named". An empty render that is not portal-only means a
    // component silently stopped rendering, which is a real regression.
    expect(
      rendered.filter((r) => r.markup.length === 0 && !PORTAL_ONLY.has(r.id)).map((r) => r.id),
      'a component rendered empty markup without being portal-only — its content was never swept',
    ).toEqual([])
    expect(
      rendered
        .filter((r) => r.markup.length === 0)
        .map((r) => r.id)
        .sort(),
      'the set of portal-only components changed — update PORTAL_ONLY deliberately',
    ).toEqual([...PORTAL_ONLY].sort())

    // The skip list is pinned, so a new unrenderable component is a visible diff
    // and a stale entry cannot linger after someone renders it.
    // Sorted on both sides: the list is a SET of documented limits, and its order in
    // the source carries no meaning worth a failure.
    expect(skipped.map((s) => `${s.id} — ${s.reason}`).sort()).toEqual([...EXPECTED_SKIPS].sort())
  })

  it('documents every file it does not render, and no others', () => {
    const onDisk = componentFiles()
    const registered = new Set(REGISTRY.map((c) => c.id))
    const missing = onDisk.filter((f) => !registered.has(f))
    expect(
      missing,
      'a component file exists that the sweep never mentions — add it to REGISTRY, rendered or skipped',
    ).toEqual([])
    // …and the reverse: no registry entry for a file that is gone.
    const gone = [...registered].filter((id) => !onDisk.includes(id))
    expect(gone, 'REGISTRY names a file that does not exist').toEqual([])
  })

  it('has no duplicate registry entries', () => {
    const ids = REGISTRY.map((c) => c.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    // …and each entry has exactly one of render / skip.
    expect(REGISTRY.filter((c) => Boolean(c.render) === Boolean(c.skip)).map((c) => c.id)).toEqual(
      [],
    )
  })
})

/**
 * Every `.tsx` under `components/`, as repo-relative paths. Read from disk so
 * the coverage test compares the registry against the real tree: a new
 * component that nobody registered fails here by name.
 */
function componentFiles(): string[] {
  const base = fileURLToPath(new URL('./', import.meta.url))
  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${full}/`)
      else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
        out.push(relative(repoRoot, full))
      }
    }
  }
  walk(base)
  return out.sort()
}

// Deliberately short and deliberately pinned. Every entry is a real limit of a
// server render, not a deferral: the failure message prints them all, so this
// list is the sweep's own statement of what it does not reach.
/**
 * Components that render EMPTY markup in a server render, and why.
 *
 * Not a deferral and not fixable by passing different props: `9ui`'s
 * `DialogContent` wraps its children in Base UI's `DialogPortal`, and a portal has
 * no server-render output at all. `InvitePlayersDialog` is in this file rendered
 * with `open: true` and still produces nothing, which is the proof that the
 * limit is the portal rather than the state.
 *
 * This is the cost of having no DOM, stated as a list rather than absorbed. The
 * names inside these dialogs are therefore NOT covered by this sweep — which is
 * exactly the gap `a11ySource.test.ts` and `a11yOverlay.test.ts` cover by other
 * means, and exactly what a jsdom project would close.
 */
const PORTAL_ONLY = new Set([
  // Both still render EMPTY with the portal inlined, and for the SAME reason: each
  // gates its content on state that only a `useEffect` populates, and
  // `renderToStaticMarkup` runs no effects. Neither is a portal problem any more —
  // mocking the portal is what exposed that the real blocker is the effect.
  //
  // AnalysisLinkControl holds `students` at null until its fetch resolves, and
  // returns early while it is null.
  'components/org/AnalysisLinkControl.tsx',
  // NotificationBell holds `inAppEnabled` at null until its preference fetch resolves.
  'components/notifications/NotificationBell.tsx',
])

const EXPECTED_SKIPS: string[] = [
  // Not a component at all: a pure `buildSettingsSections()` that returns
  // `SettingsSection[]`. Rendering it would exercise no markup of its own; its
  // consumer SettingsPanel is rendered, and its data shape is pinned by the server
  // contract tests.
  'components/org/settings/buildSettingsSections.tsx — not a component; it exports a pure data function with no JSX',
  'components/MarketingLanding.tsx — marketing page component, requires server context not available in sweep',
  'components/org/OrgSwitcher.tsx — requires org context provider not available in sweep',
  'components/dashboard/DashboardAnalyseClient.tsx — drives the live scan pipeline from usePipeline; renders no markup until a job exists',

  // These read `usePreferences()` at the top level, and the context has no
  // default. withPrefs() supplies it, so these are NOT harness limits in
  // principle — but each also reaches something else the server render cannot
  // satisfy, and the failure names which. Kept as skips with the specific cause
  // rather than a blanket "needs a provider", so the reason is falsifiable.
  //
  // `SettingsPanel` and `StudentsClient` used to be here on claims that no longer
  // reproduce, and neither was ever re-tested: a skip entry carries no `render`,
  // so CI had nothing that could have noticed. Both are rendered now.
  'components/HeaderClient.tsx — throws reading preferences before its own markup renders (needs the client-side provider and its auth-dependent submenu state)',
  'components/org/SettingsClient.tsx — same: usePreferences() outside its provider, and it fetches sections on mount',

  // Genuinely unreachable here, not a deferral: a component that SUSPENDS during
  // a server render throws instead of emitting markup, and `renderToStaticMarkup`
  // has no boundary to catch it with. Wiring a Suspense fallback would change the
  // markup under test, which defeats the point of the assertion.
  'components/AuthHeader.tsx — suspends during the server render (a component suspended while responding to synchronous input)',
]
