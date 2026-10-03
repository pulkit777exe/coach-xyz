// Renders the components whose accessible name / keyboard affordance the audit
// found broken, and asserts the DOM that comes out. `renderToStaticMarkup` is
// the whole DOM assertion available here: vitest.config.mts is
// `include: ['lib/**/*.test.ts']` with `environment: 'node'`, so there is no
// jsdom and no event dispatch. Every assertion below is therefore a read of
// real rendered markup, not of the source — see a11ySource.test.ts for the few
// things markup cannot reach (the dialog name inside Base UI's portal, and the
// effect-only focus/inert wiring).

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import AnalysisTitle from '@/components/AnalysisTitle'
import { ChatInput } from '@/components/ChatInput'
import { HoldToConfirm } from '@/components/interior/hold-to-confirm'
import { Modal } from '@/components/interior/modal'
import { Drawer } from '@/components/interior/drawer'
import PlayerSelector from '@/components/PlayerSelector'
import { PreferencesProvider } from '@/lib/preferences'

// StudentProfile calls useRouter; without an app router mounted the invariant
// throws before the component renders anything.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))

// recharts' ResponsiveContainer measures itself, so in a server render it emits
// an empty 0x0 div and swallows its children — the tooltip content never
// reaches the markup. Pass the children straight through instead.
vi.mock('recharts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: unknown }) => children,
  }
})

const html = (node: React.ReactElement) => renderToStaticMarkup(node)

// The interior overlays declare `children` as a required prop, which
// createElement-with-children-as-arguments cannot satisfy. They render no
// children here, so cast rather than loosen the components' public types.
const overlay = (Component: React.ComponentType<never>, props: object, child = null) =>
  createElement(Component as React.ComponentType<never>, props as never, child)

describe('AnalysisTitle exposes rename as a real control', () => {
  const title = () =>
    html(
      createElement(AnalysisTitle, {
        auth0Id: 'org|1',
        jobId: 'job-1',
        displayName: 'Dunk',
        fileName: 'dunk.mp4',
      }),
    )

  it('is a button, so Enter/Space and focus come from the element', () => {
    // Was: an <h1 onClick> with cursor-pointer — reachable by pointer only, so
    // a keyboard or screen-reader user could not rename an analysis at all.
    const markup = title()
    expect(markup).toContain('<button type="button"')
    expect(markup).toMatch(/<h1[^>]*><button/)
    expect(markup).not.toMatch(/<h1[^>]*onClick|role="button"/)
  })

  it('keeps the heading level and the title attribute', () => {
    const markup = title()
    expect(markup).toContain('<h1')
    expect(markup).toContain('title="Click to rename"')
    expect(markup).toContain('Dunk')
    // The hover affordance (✎ on group-hover) must survive the element swap.
    expect(markup).toContain('group-hover:opacity-60')
  })
})

describe('the interior overlays are named dialogs', () => {
  it('Modal names itself from its visible title', () => {
    const markup = html(
      overlay(Modal as never, { open: true, onClose: () => {}, title: 'Share Analysis' }),
    )
    // Was role="dialog" aria-modal="true" with an unassociated <h2>: announced
    // as a bare "dialog".
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(markup).toContain(`<h2 id="${labelledBy}"`)
    expect(markup).toContain('Share Analysis')
    expect(markup).toContain('aria-modal="true"')
  })

  it('Drawer names itself from its visible title', () => {
    const markup = html(
      overlay(Drawer as never, { open: true, onOpenChange: () => {}, title: 'Analysis Metadata' }),
    )
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(markup).toContain(`<h2 id="${labelledBy}"`)
    expect(markup).toContain('Analysis Metadata')
  })

  it('the modal panel is focusable so focus can start inside it', () => {
    const markup = html(overlay(Modal as never, { open: true, onClose: () => {}, title: 'T' }))
    expect(markup).toMatch(/role="dialog"[^>]*tabindex="-1"|tabindex="-1"[^>]*role="dialog"/)
  })

  it('the backdrop is no longer the first focusable node in the modal', () => {
    // Was: a full-screen <button aria-label="Close">, i.e. the first Tab
    // landed on an invisible "Close" scrim.
    const markup = html(overlay(Modal as never, { open: true, onClose: () => {}, title: 'T' }))
    expect(markup).not.toContain('aria-label="Close"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('a closed drawer is inert rather than merely off-screen', () => {
    // The Drawer stays mounted while closed (slide-out animation), so before
    // this its Close button was in the tab order of a dialog nobody opened.
    const markup = html(
      overlay(Drawer as never, {
        open: false,
        onOpenChange: () => {},
        title: 'Analysis Metadata',
      }),
    )
    expect(markup).toContain('inert=""')
    expect(markup).not.toContain('aria-modal="true"')
  })

  it('an open drawer is not inert', () => {
    const markup = html(
      overlay(Drawer as never, { open: true, onOpenChange: () => {}, title: 'T' }),
    )
    expect(markup).not.toContain('inert')
    expect(markup).toContain('aria-modal="true"')
  })
})

// HoldToConfirm declares `children` as a required prop, which
// createElement-with-children-as-arguments cannot satisfy. Cast rather than
// loosen the component's public type.
const hold = (confirmLabel: string, child: React.ReactNode) =>
  createElement(HoldToConfirm as never, { onConfirm: () => {}, confirmLabel } as never, child)

describe('two hold-to-confirms on one page no longer share a hint id', () => {
  it('gives each instance its own describedby target', () => {
    // The analysis page renders Cancel and Delete side by side; both used the
    // literal id "hold-to-confirm-hint", so the second button's
    // aria-describedby resolved to the first button's hint.
    const markup = html(
      createElement(
        'div',
        null,
        hold('Cancelled', createElement('span', null, 'Cancel')),
        hold('Deleted', createElement('span', null, 'Delete')),
      ),
    )
    const describedBy = [...markup.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1])
    expect(describedBy).toHaveLength(2)
    expect(new Set(describedBy).size).toBe(2)
    for (const id of describedBy) {
      expect(markup).toContain(`<span id="${id}" class="sr-only">`)
    }
  })
})

describe('PlayerSelector angle switcher', () => {
  const selector = (activeAngle: string) =>
    html(
      createElement(PlayerSelector, {
        players: [{ player_index: 0, confidence: 0.9, crop_base64: '' }],
        angles: ['side', 'front'],
        activeAngle,
        onAngleChange: () => {},
        onAddAngle: () => {},
        onSelect: () => {},
      }),
    )

  it('is a labelled group of toggle buttons, not an unowned tab set', () => {
    const markup = selector('side')
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Camera angles"')
    expect(markup).not.toContain('role="tablist"')
    expect(markup).not.toContain('role="tab"')
    expect(markup).not.toContain('aria-selected')
  })

  it('marks exactly the active angle as pressed', () => {
    const markup = selector('front')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>front|aria-pressed="true"[^>]*/)
    // side is not active here, so it must not read as pressed.
    const pressed = [...markup.matchAll(/aria-pressed="(true|false)"[^>]*>([a-z]+)</g)].map(
      (m) => `${m[2]}=${m[1]}`,
    )
    expect(pressed).toEqual(expect.arrayContaining(['side=false']))
    expect(pressed.filter((p) => p.endsWith('=true'))).toHaveLength(1)
  })
})

describe('the chart tooltip renders a zero value like any other', () => {
  const tooltip = async (value: number) => {
    const { ChartContainer, ChartTooltipContent } = await import('@/components/9ui/ui/chart')
    return html(
      createElement(
        ChartContainer as never,
        { config: { a: { label: 'A', color: 'red' } } } as never,
        createElement(ChartTooltipContent, {
          active: true,
          payload: [{ value, name: 'a', dataKey: 'a', payload: { fill: 'red' } }],
          label: 'row',
        } as never),
      ),
    )
  }

  it('wraps 0 in the styled value span instead of emitting a bare 0', async () => {
    // Was `{item.value && <span …>}`: a metric of exactly 0 rendered as an
    // unstyled "0" sitting in the label column, which reads as the label's
    // own value. Reachable — the metric form only checks Number.isFinite and
    // its input is type="number" step="any" with no min.
    const zero = await tooltip(0)
    expect(zero).toContain(
      '<span class="text-foreground ml-4 font-mono font-medium tabular-nums">0</span>',
    )
  })

  it('still renders a non-zero value the same way', async () => {
    const other = await tooltip(1234)
    expect(other).toContain(
      '<span class="text-foreground ml-4 font-mono font-medium tabular-nums">1,234</span>',
    )
  })
})

describe('a jersey number of 0 renders as the #0 chip', async () => {
  it('does not degrade to a bare 0', async () => {
    const { default: StudentProfile } = await import('@/components/org/StudentProfile')
    const markup = html(
      createElement(StudentProfile, {
        auth0Id: 'org|1',
        student: {
          id: 's1',
          full_name: 'Ada',
          jersey_number: 0,
          status: 'active',
        },
        initialSeries: [],
        initialAttendance: null,
        initialReports: [],
        allAnalyses: [],
        sports: [],
        canWrite: false,
      } as never),
    )
    // Was `{student_.jersey_number && <span>#{…}</span>}`: 0 is falsy, so the
    // row rendered a lone "0" among the sport/position metadata.
    expect(markup).toContain('<span>#0</span>')
  })

  it('omits the chip entirely when there is no jersey number', async () => {
    const { default: StudentProfile } = await import('@/components/org/StudentProfile')
    const markup = html(
      createElement(StudentProfile, {
        auth0Id: 'org|1',
        student: { id: 's1', full_name: 'Ada', jersey_number: null, status: 'active' },
        initialSeries: [],
        initialAttendance: null,
        initialReports: [],
        allAnalyses: [],
        sports: [],
        canWrite: false,
      } as never),
    )
    expect(markup).not.toContain('#0')
  })
})

describe('form controls carry an accessible name, not only a placeholder', () => {
  it('ChatInput textarea is named independently of its placeholder', () => {
    const markup = html(createElement(ChatInput, { onSend: () => {}, placeholder: 'Loading...' }))
    // The placeholder becomes "Loading..." while history is in flight, so it
    // cannot be the name.
    expect(markup).toMatch(/<textarea[^>]*aria-label="Message"/)
  })

  it('the theme SelectTrigger is labelled', async () => {
    // Only the value was announced before ("Dark") — no name at all.
    const { default: PreferencesSection } = await import('@/components/org/PreferencesSection')
    const markup = html(
      createElement(PreferencesProvider, null, createElement(PreferencesSection, {})),
    )
    expect(markup).toContain('aria-label="Theme"')
  })

  it('the compare-metric SelectTrigger is labelled', async () => {
    const { default: StudentProfile } = await import('@/components/org/StudentProfile')
    const markup = html(
      createElement(StudentProfile, {
        auth0Id: 'org|1',
        student: { id: 's1', full_name: 'Ada', jersey_number: 7, status: 'active' },
        initialSeries: [],
        initialAttendance: null,
        initialReports: [],
        allAnalyses: [],
        sports: [],
        canWrite: false,
      } as never),
    )
    expect(markup).toContain('aria-label="Metric to compare"')
    // It sits beside a <p> heading, which is not a label — nothing else
    // associates them.
    expect(markup).toContain('Compare with Teammates')
  })
})
