import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import ProStatsPanel from '@/components/analysis/ProStatsPanel'
import type { ProfessionalStats } from '@/types'

// ── Provenance has to survive the render ─────────────────────────────────────
// The engine labels every stat `measured`, `counted` or `observed`, and lists
// what the clip cannot answer. A panel that rendered a bare number grid would
// throw those distinctions away at exactly the point a coach reads them. These
// assertions pin the visible contract: the label, the honest gap list, and
// integer counts that do not read as measurements ("3.0 attempts").

const stats: ProfessionalStats = {
  groups: [
    {
      key: 'output',
      label: 'Output',
      stats: [
        { key: 'attempts', label: 'Attempts', unit: '', value: 3, source: 'counted', note: 'moments judged to be real actions' },
        { key: 'conversion', label: 'Conversion', unit: '%', value: 66.7, source: 'counted' },
      ],
    },
    {
      key: 'technique',
      label: 'Technique',
      stats: [
        {
          key: 'arm_extension',
          label: 'Shooting arm extension',
          unit: '/10',
          value: 8.4,
          source: 'measured',
          band: 'developing',
          note: '3 events scored',
        },
        {
          key: 'balance',
          label: 'Upright balance',
          unit: '/10',
          value: 6.1,
          source: 'observed',
          band: 'developing',
          note: '2 events scored from model ratings',
        },
      ],
    },
  ],
  event_breakdown: [{ type: 'catch_and_shoot', label: 'Catch and shoot', count: 2, share: 66.7 }],
  outcomes: [{ result: 'made', label: 'Made', count: 2, tone: 'positive' }],
  tags: [{ tag: 'high release', count: 2 }],
  trend: null,
  provenance: { measured: 1, counted: 2, observed: 1 },
  bands: { developing: 'mean technique score 6.0-8.4 / 10' },
  unavailable: [
    { label: 'Shot chart / court location', reason: 'the camera view is not mapped to court coordinates' },
  ],
}

const html = renderToStaticMarkup(
  <ProStatsPanel
    stats={stats}
    tacticalSummary="The release repeated; the landing broke down late."
    keyInsights={['Keep the release height.']}
  />,
)

describe('ProStatsPanel — provenance is visible, gaps are named', () => {
  test('labels each stat with how it was produced', () => {
    expect(html).toContain('Measured')
    expect(html).toContain('Counted')
    expect(html).toContain('Observed')
    expect(html).toContain('1</span> measured')
    expect(html).toContain('2</span> counted')
    expect(html).toContain('1</span> observed')
  })

  test('renders integer counts as integers, not measurements', () => {
    expect(html).toContain('Attempts')
    expect(html).toContain('>3<')
    expect(html).not.toContain('3.0')
  })

  test('lists the stats the clip cannot produce, with the reason', () => {
    expect(html).toContain('Stats this clip cannot produce')
    expect(html).toContain('Shot chart / court location')
    expect(html).toContain('the camera view is not mapped to court coordinates')
  })

  test('shows the coach read and the observed-pattern caveat', () => {
    expect(html).toContain('The release repeated; the landing broke down late.')
    expect(html).toContain('Keep the release height.')
    expect(html).toContain('Model-observed labels, not measured values.')
  })

  test('renders nothing when there is no professional layer (old cached results)', () => {
    expect(renderToStaticMarkup(<ProStatsPanel stats={null} />)).toBe('')
  })
})
