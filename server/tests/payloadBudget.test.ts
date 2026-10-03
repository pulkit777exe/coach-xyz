import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'

import { setHistoryStoreConnectionForTests, withHistoryStoreOrThrow } from '../src/lib/historyStore'
import { getUserAnalyses, getUserAnalysisById } from '../src/lib/analyses'

// ── Payload budget: the projection is a SIZE contract, not a style choice ─────
//
// The perf round measured what the missing list projection actually cost: five
// list call sites read exactly one number out of `summary_json` — `form_score` —
// and shipped the whole blob with it. History 1388 KB -> 12.5 KB, student detail
// 19835 KB -> 178 KB. Those are big, cheap wins, and every one of them is
// invisible to a test that asserts a status code.
//
// Latency cannot be gated in CI: a shared runner's timings are far too noisy, and
// a flaky perf gate gets disabled, which is worse than none. **Size can.** It is
// deterministic, it fails for exactly one reason (a column came back), and it is
// the property the optimisation was actually after — the bytes are what a coach's
// browser downloads and what the server JSON-serialises on the event loop. So
// this file pins bytes, and the shape assertions stay in analysisListProjection.
//
// The ceiling below is deliberately loose relative to what the projection
// delivers (measured: a 20-event row projects to ~0.6 KB against a ~66 KB blob)
// — it is here to catch a regression to "ships the whole summary", not to
// re-tune the projection. A ceiling set at the measured value would fail on any
// legitimate schema addition; an order of magnitude catches the class. The
// scale-free assertion is the ratio test: a list row must be at least 10x
// smaller than the detail row for the SAME underlying data.

const ORG = 'auth0|payload-budget-org'
const ROWS = 20

// A summary shaped like a real engine row: shot_events carrying joint angles,
// weighted criteria and injury_risk, plus findings and tips. Built here rather
// than imported from the engine so the test owns its own size, and asserted
// below to be big enough that a missing projection cannot pass by accident.
const bigSummary = (events: number) => ({
  form_score: 7.25,
  shot_events: Array.from({ length: events }, (_, i) => ({
    timestamp: i * 0.4,
    result: i % 3 === 0 ? 'made' : 'miss',
    injury_risk: i % 7 === 0 ? 'moderate' : null,
    biomechanics: {
      elbow: 168.4 + i,
      knee: 174.2 - i,
      hip_rotation: 92.1 + i / 2,
      shoulder_external_rotation: 88.6,
      trunk_lean: 4.2 + (i % 5),
    },
    weighted_scoring: {
      value: 0.82,
      criteria: [
        { name: 'release', score: 0.9, weight: 0.2, rationale: 'good hip drive into the shot' },
        { name: 'follow-through', score: 0.7, weight: 0.25, rationale: 'shortened at the wrist' },
        { name: 'balance', score: 0.85, weight: 0.3, rationale: 'stable landing' },
        { name: 'timing', score: 0.6, weight: 0.25, rationale: 'slightly late off the floor' },
      ],
    },
  })),
  findings: Array.from({ length: events }, (_, i) => ({
    id: `f-${i}`,
    category: 'technique',
    observation: `observation ${i}: the elbow drifts late in the release window`,
    feedback: `feedback ${i}: keep the wrist stacked through the follow-through`,
    confidence: 0.78,
    severity: 'low',
  })),
  quality: { sharpness: 0.9, lighting: 0.8, framing: 0.85, duration_s: 12.4 },
  top_tips: [
    'Keep the elbow under the ball through the release window.',
    'Shorten the follow-through rather than reaching at the apex.',
  ],
})

let db: SQL | null = null

beforeAll(async () => {
  db = new SQL((process.env.TEST_DATABASE_URL ?? process.env.PERF_DATABASE_URL ?? '').trim())
  if (!db) throw new Error('payload budget needs TEST_DATABASE_URL or PERF_DATABASE_URL')
  setHistoryStoreConnectionForTests(db)
  await db`delete from analysis_history where auth0_id = ${ORG}`
  for (let i = 0; i < ROWS; i++) {
    await db`
      insert into analysis_history
        (server_job_id, engine_job_id, auth0_id, student_id, model, complete,
         display_name, requested_at, summary_json)
      values (
        ${`33333333-3333-4333-8333-${String(i).padStart(12, '0')}`}::uuid,
        ${`33333333-3333-4333-8333-${String(i).padStart(12, '0')}`}::uuid,
        ${ORG},
        ${`44444444-4444-4444-8444-${String(i).padStart(12, '0')}`}::uuid,
        'gemini',
        true,
        ${`Session ${i}`},
        now(),
        ${JSON.stringify(bigSummary(20))}::jsonb
      )
    `
  }
})

afterAll(async () => {
  const conn = db
  db = null
  if (conn) {
    await conn`delete from analysis_history where auth0_id = ${ORG}`
    await conn.close()
  }
})

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value ?? null))

describe('a list response is a size contract', () => {
  test('the fixture is big enough that a missing projection cannot pass by luck', () => {
    // Scale-free on purpose. An absolute "a real row is 66 KB" threshold would
    // be a guess about the engine's payload that rots the first time a joint or a
    // criterion is added; what matters is that the detail row is big enough for
    // the ratio below to be meaningful, so the floor is a tenth of the ceiling.
    const detail = bytes(bigSummary(20))
    expect(detail).toBeGreaterThan(10_000)
    expect(bytes({ summary_json: bigSummary(20) }) * ROWS).toBeGreaterThan(200_000)
  })

  test('a 20-row list stays under 100 KB — it was ~1.3 MB', async () => {
    const rows = await withHistoryStoreOrThrow(() => getUserAnalyses(ORG))
    expect(rows.length).toBe(ROWS)
    expect(bytes(rows)).toBeLessThan(100_000)
    // The projection still delivers what the UI reads, which is the other half
    // of the contract: a small payload that dropped the score would be a bug too.
    expect(
      rows.every(
        (r) => typeof (r.summary_json as { form_score?: unknown })?.form_score === 'number',
      ),
    ).toBe(true)
  })

  test('a list row is an order of magnitude smaller than a detail row', async () => {
    // The actual contract, and the one that does not rot: LIST << DETAIL for the
    // same underlying row. Measured on the same seed, so a change to either side
    // that erodes the ratio fails here.
    const rows = await withHistoryStoreOrThrow(() => getUserAnalyses(ORG))
    const detail = await withHistoryStoreOrThrow(() =>
      getUserAnalysisById(ORG, '33333333-3333-4333-8333-000000000000'),
    )
    expect(detail).not.toBeNull()
    const perRowList = bytes(rows) / rows.length
    const perRowDetail = bytes(detail) / 1
    expect(perRowList).toBeLessThan(perRowDetail / 10)
  })

  test('a single detail read is still allowed to be large', async () => {
    // The ceiling is on LISTS only. `getUserAnalysisById` keeps the full blob —
    // it is what backs the share, chat and clip routes and the §5 redaction
    // decision, and narrowing it would be a behaviour change, not an optimisation.
    const one = await withHistoryStoreOrThrow(() =>
      getUserAnalysisById(ORG, '33333333-3333-4333-8333-000000000000'),
    )
    expect(one).not.toBeNull()
    expect(bytes(one)).toBeGreaterThan(10_000)
    const events = (one!.summary_json as { shot_events?: unknown[] })?.shot_events
    expect(Array.isArray(events) && events.length).toBe(20)
  })

  test('a list row carries no wellness payload', async () => {
    // Belt and braces on the size ceiling: if the size assertion ever needs
    // loosening, this still fails if the blob starts coming back.
    const rows = await withHistoryStoreOrThrow(() => getUserAnalyses(ORG))
    for (const row of rows) {
      const summary = row.summary_json as Record<string, unknown> | null
      expect(summary).not.toBeNull()
      expect(Object.keys(summary as object).sort()).toEqual(['form_score'])
    }
  })
})
