import { describe, expect, test } from 'bun:test'
import type { AnalysisSummary } from '../src/types'

// Canonical wire contract emitted by engine normalize_gemini_result.
// Assigning this literal to the AnalysisSummary type is a compile-time guard:
// any key the engine emits that the type no longer declares (or a type that
// gains a required key the engine does not emit) fails here.
const CANONICAL: AnalysisSummary = {
  sport: 'cricket',
  player_name: 'Alice',
  session_date: '2025-01-02',
  form_score: 7.5,
  overall_rating: 'Good',
  top_tips: ['follow through', 'head position'],
  summary: 'Overall rating: Good.',
  strengths: ['balance'],
  priority_drill: 'Shadow drive',
  shot_events: [
    {
      timestamp: 90,
      event_type: 'drive',
      form_score: 7.5,
      feedback: 'Good timing.',
      result: 'four',
      form_breakdown: { elbow: 'good', head: 'needs_work' },
      biomechanics: { confidence: 0.9 },
      weighted_scoring: { composite_score: 7.6 },
      injury_risk: null,
      key_observation: 'head: needs_work',
    },
  ],
  success_rate_percent: 62,
  average_form_score: 7.5,
  total_events: 1,
  angle: 'side',
  recommended_angles: [{ id: 'front', label: 'Front view', description: 'Best second angle.' }],
  provenance: {
    engine: '0.2.0',
    model: 'gemini-2.5-flash',
    analysis_prompt: '1',
    sport: 'cricket',
    sport_pack_version: 1,
    analyzed_at: '2026-01-01T00:00:00+00:00',
  },
  findings: [
    {
      id: 'job:e1',
      category: 'drive',
      start_ms: 90000,
      end_ms: 94000,
      confidence: 0.9,
      confidence_band: 'high',
      severity: 'medium',
      observation: 'head: needs_work',
      feedback: 'Good timing.',
      form_score: 7.5,
      evidence_frames: [375],
      measured_at_timestamp: 90,
      model_versions: { model: 'gemini-2.5-flash' },
      review_state: 'auto',
    },
  ],
}

const REQUIRED_TOP_LEVEL = [
  'sport',
  'form_score',
  'overall_rating',
  'top_tips',
  'summary',
  'strengths',
  'shot_events',
]

const REQUIRED_SHOT_EVENT = ['timestamp', 'event_type', 'form_score', 'feedback']

describe('analysis result contract', () => {
  test('canonical fixture satisfies the AnalysisSummary type', () => {
    expect(CANONICAL).toBeTypeOf('object')
    expect(Array.isArray(CANONICAL.shot_events)).toBe(true)
  })

  test('required fields are present on the wire', () => {
    for (const key of REQUIRED_TOP_LEVEL) {
      expect(CANONICAL).toHaveProperty(key)
    }
    expect(CANONICAL.shot_events.length).toBeGreaterThan(0)
    for (const key of REQUIRED_SHOT_EVENT) {
      expect(CANONICAL.shot_events[0]).toHaveProperty(key)
    }
  })

  test('optional enriched fields survive round-trip typed', () => {
    const event = CANONICAL.shot_events[0]
    expect(event.result).toBe('four')
    expect(event.form_breakdown?.['head']).toBe('needs_work')
    expect(event.biomechanics?.['confidence']).toBe(0.9)
  })
})
