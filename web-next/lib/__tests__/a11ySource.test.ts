// Source-level tripwires for the three a11y fixes that no render in this suite
// can observe, and why each one is here rather than in a11yControls.test.ts:
//
// 1. GlobalSearch's Ctrl+K dialog. Base UI's `DialogPortal` renders into
//    document.body, so `renderToStaticMarkup` emits nothing for the popup — and
//    the dialog is closed on first render anyway. (The audit verified the
//    before-state by rendering in a browser: `role=dialog
//    aria-labelledby=null aria-label=null`, because `DialogPopup` takes its
//    name from `store.useState('titleElementId')`, set only by `DialogTitle`.)
// 2. The share-link input inside the analysis Share modal. The modal is driven
//    by `useState`, so it is closed in any server render; there is no prop to
//    open it with.
// 3. `errorFromResponse` is the one place a response becomes a CoachAIError,
//    and the hand-built literals it replaced are gone — asserted here as a
//    grep so they cannot come back one file at a time.
//
// Modelled on typeScale.test.ts / permissions.test.ts: read the file, assert
// the contract. A grep is a weaker check than a render, and these are the three
// places where it is the only one available.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { relative } from 'node:path'

const ROOT = new URL('../../', import.meta.url)
const ROOT_PATH = fileURLToPath(ROOT)

const read = (...segments: string[]) =>
  readFileSync(fileURLToPath(new URL(segments.join('/'), ROOT)), 'utf8')

/** Every .tsx under components/, excluding the vendored primitives dir. */
function componentFiles(): URL[] {
  const out: URL[] = []
  const walk = (dir: URL) => {
    for (const entry of readdirSync(fileURLToPath(dir), { withFileTypes: true })) {
      if (entry.name === '9ui') continue
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.tsx')) out.push(child)
    }
  }
  walk(new URL('components/', ROOT))
  return out
}

describe('GlobalSearch names its Ctrl+K dialog', () => {
  const src = read('components/GlobalSearch.tsx')

  it('renders a DialogTitle inside the dialog content', () => {
    // Base UI sets aria-labelledby from the title element's id, and that id is
    // only registered by DialogTitle. Without it the popup is a bare "dialog".
    expect(src).toContain('<DialogTitle className="sr-only">Search</DialogTitle>')
    // …and it must be inside the DialogContent, not a sibling of it.
    const contentAt = src.indexOf('<DialogContent')
    const titleAt = src.indexOf('<DialogTitle')
    const closeAt = src.indexOf('</DialogContent>')
    expect(contentAt).toBeGreaterThan(-1)
    expect(titleAt).toBeGreaterThan(contentAt)
    expect(titleAt).toBeLessThan(closeAt)
  })

  it('also sets an explicit aria-label, matching the SidebarSearch sibling', () => {
    expect(src).toMatch(/<DialogContent[\s\S]{0,200}aria-label="Search"/)
  })

  it('imports DialogTitle from the 9ui dialog rather than a local copy', () => {
    expect(src).toContain(
      "import { Dialog, DialogContent, DialogTitle } from '@/components/9ui/ui/dialog'",
    )
  })

  it('leaves the visible design alone — the title is sr-only, no close button added', () => {
    expect(src).toContain('showCloseButton={false}')
    // Escape still dismisses via Base UI's useDismiss default; no new affordance.
    expect(src).not.toContain('onKeyDown={')
  })

  it('names the search field itself, not just its placeholder', () => {
    expect(src).toMatch(/aria-label="Search students, reports, analyses"/)
  })
})

describe('the share-link field is labelled', () => {
  const src = read('components/AnalysisDetailClient.tsx')

  it('has a real <label htmlFor> bound to the input id', () => {
    expect(src).toContain('<label htmlFor="analysis-share-url" className="sr-only">')
    expect(src).toContain('id="analysis-share-url"')
  })

  it('the label precedes the input it names, inside the Share modal', () => {
    const labelAt = src.indexOf('htmlFor="analysis-share-url"')
    const inputAt = src.indexOf('id="analysis-share-url"')
    const modalAt = src.indexOf('<Modal')
    expect(labelAt).toBeGreaterThan(modalAt)
    expect(labelAt).toBeLessThan(inputAt)
  })

  it('still renders the value, readonly', () => {
    expect(src).toMatch(/id="analysis-share-url"[\s\S]{0,120}readOnly/)
  })
})

describe('the placeholder-only names at the other three sites are gone', () => {
  const cases: [string, string, string][] = [
    [
      'components/org/StudentsClient.tsx',
      'Search students',
      'placeholder="Search name, email, sport…"',
    ],
    [
      'components/HistoryChat.tsx',
      'Ask about your analysis',
      'placeholder="Ask about your analysis..."',
    ],
    ['components/AnalysisTitle.tsx', 'Analysis name', 'value={draft}'],
  ]

  for (const [file, label, near] of cases) {
    it(`${file} names its field with aria-label`, () => {
      const src = read(file)
      const labelAt = src.indexOf(`aria-label="${label}"`)
      expect(labelAt, `missing aria-label="${label}"`).toBeGreaterThan(-1)
      // On the same element as the placeholder/value it belongs to — JSX prop
      // order varies, so accept either direction within one tag.
      const nearAt = src.indexOf(near)
      expect(Math.abs(nearAt - labelAt), 'aria-label is not beside its field').toBeLessThan(400)
    })
  }

  it('the students search input matches its labelled SelectTrigger siblings', () => {
    const src = read('components/org/StudentsClient.tsx')
    expect(src).toContain('aria-label="Search students"')
    expect(src).toContain('aria-label="Filter by sport"')
  })
})

describe('the two unlabelled SelectTriggers are labelled', () => {
  it('PreferencesSection names the theme trigger', () => {
    expect(read('components/org/PreferencesSection.tsx')).toContain('aria-label="Theme"')
  })

  it('StudentProfile names the compare-metric trigger', () => {
    // The section heading beside it is a <p>, not a <label>, so there was
    // nothing to associate — and with no name the trigger announces only the
    // current value.
    expect(read('components/org/StudentProfile.tsx')).toContain('aria-label="Metric to compare"')
  })

  it('no SelectTrigger in the repo is left without a name', () => {
    // The audit counted 20 of 22 named. Walking the whole component tree (not a
    // hand-listed subset) means a new bare trigger fails here rather than
    // announcing only its current value.
    const bare: string[] = []
    let checked = 0
    for (const file of componentFiles()) {
      const src = readFileSync(fileURLToPath(file), 'utf8')
      for (const m of src.matchAll(/<SelectTrigger\b([^>]*)>/g)) {
        checked += 1
        const attrs = m[1]
        const named =
          attrs.includes('aria-label') || attrs.includes('aria-labelledby') || attrs.includes('id=')
        if (!named) {
          bare.push(
            `${relative(ROOT_PATH, fileURLToPath(file))}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`,
          )
        }
      }
    }
    expect(checked).toBeGreaterThan(15)
    expect(bare).toEqual([])
  })
})

describe('the two hand-built CoachAIError literals are gone from the client', () => {
  it('useScanFlow routes its cancellation through lib/errors', () => {
    const src = read('lib/useScanFlow.ts')
    expect(src).toContain('clientError(')
    expect(src).not.toContain('as CoachAIError')
    expect(src).not.toMatch(/layer: 'client'/)
  })

  it('notifications fetch routes through errorFromResponse like its siblings', () => {
    const src = read('lib/notifications.ts')
    expect(src).toContain('throw errorFromResponse(')
    expect(src).toContain('NOTIFICATIONS_FETCH_FAILED')
    // The status stays in the message, so the log still says which one failed.
    expect(src).toContain('Failed to fetch notifications (${res.status})')
    // …and nothing throws a bare Error out of a fetch path.
    expect(src).not.toContain('throw new Error(`Failed to fetch notifications')
  })

  it('the snapshot retry stops on a non-retryable status', () => {
    const src = read('lib/notifications.ts')
    expect(src).toContain('isCoachAIError(error) && error.retryable === false')
  })
})
