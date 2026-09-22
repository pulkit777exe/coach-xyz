import { describe, expect, test } from 'bun:test'

import {
  FINDINGS_CSV_COLUMNS,
  findingsToCsv,
  type StoredFinding,
} from '../src/lib/findings'

const finding = (overrides: Partial<StoredFinding> = {}): StoredFinding => ({
  id: 'job1:e1',
  server_job_id: 'job1',
  category: 'release_point',
  start_ms: 1200,
  end_ms: 1800,
  confidence: 0.82,
  confidence_band: 'high',
  severity: 'medium',
  observation: 'Elbow flares out',
  feedback: 'Tuck the elbow in',
  form_score: 6,
  evidence_frames: [],
  measured_at_timestamp: 1.2,
  model_versions: {},
  review_state: 'auto',
  created_at: '2026-09-20T10:00:00.000Z',
  ...overrides,
})

describe('findingsToCsv', () => {
  test('header row matches the stable column order', () => {
    const [header] = findingsToCsv([]).split('\n')
    expect(header).toBe(FINDINGS_CSV_COLUMNS.join(','))
    expect(FINDINGS_CSV_COLUMNS).toContain('review_state')
  })

  test('serializes one row per finding with nulls as empty', () => {
    const csv = findingsToCsv([
      finding(),
      finding({ id: 'job1:e2', confidence: null, observation: null, form_score: null }),
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe(
      'job1:e1,job1,release_point,1200,1800,0.82,high,medium,Elbow flares out,Tuck the elbow in,6,auto,2026-09-20T10:00:00.000Z',
    )
    expect(lines[2]).toContain('job1:e2')
    expect(lines[2].endsWith(',auto,2026-09-20T10:00:00.000Z')).toBe(true)
  })

  test('quotes commas, quotes, and newlines in free text', () => {
    const csv = findingsToCsv([
      finding({ observation: 'Hips "open", early\nsecond line', feedback: 'stay, low' }),
    ])
    expect(csv).toContain('"Hips ""open"", early\nsecond line"')
    expect(csv).toContain('"stay, low"')
  })

  test('defuses formula-injection cells with a single-quote prefix', () => {
    const csv = findingsToCsv([finding({ observation: '=cmd()', feedback: '@mention' })])
    const [, row] = csv.split('\n')
    expect(row).toContain("'=cmd()")
    expect(row).toContain("'@mention")
  })

  test('empty input yields the header only', () => {
    expect(findingsToCsv([])).toBe(FINDINGS_CSV_COLUMNS.join(','))
  })
})
