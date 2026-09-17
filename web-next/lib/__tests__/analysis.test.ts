import { describe, expect, it } from "vitest"
import { analysisScore, getShotEvents } from "../analysis"

describe("analysisScore", () => {
  it("returns a numeric form_score", () => {
    expect(analysisScore({ summary_json: { form_score: 72 } })).toBe(72)
  })

  it("returns 0 for a zero score (not falsy-guarded)", () => {
    expect(analysisScore({ summary_json: { form_score: 0 } })).toBe(0)
  })

  it("rejects non-number scores", () => {
    expect(analysisScore({ summary_json: { form_score: "72" } })).toBeNull()
    expect(analysisScore({ summary_json: { form_score: true } })).toBeNull()
  })

  it("returns null when summary_json is absent or not an object", () => {
    expect(analysisScore({})).toBeNull()
    expect(analysisScore({ summary_json: null })).toBeNull()
    expect(analysisScore({ summary_json: "raw" })).toBeNull()
  })

  it("returns null when form_score is absent", () => {
    expect(analysisScore({ summary_json: { shots: 3 } })).toBeNull()
  })

  it("tolerates null and undefined carriers", () => {
    expect(analysisScore(null)).toBeNull()
    expect(analysisScore(undefined)).toBeNull()
  })
})

describe("getShotEvents", () => {
  const events = [
    { t: 1200, label: "Ace" },
    { t: 3400, label: "Goal" },
  ]

  it("returns shot_events from a valid summary_json", () => {
    expect(getShotEvents({ summary_json: { shot_events: events } })).toEqual(events)
  })

  it("returns an empty array when summary_json is absent or malformed", () => {
    expect(getShotEvents({})).toEqual([])
    expect(getShotEvents({ summary_json: null })).toEqual([])
    expect(getShotEvents({ summary_json: "x" })).toEqual([])
    expect(getShotEvents({ summary_json: { no_events: true } })).toEqual([])
  })

  it("returns an empty array when shot_events is not an array", () => {
    expect(getShotEvents({ summary_json: { shot_events: "nope" } })).toEqual([])
    expect(getShotEvents({ summary_json: { shot_events: 3 } })).toEqual([])
  })

  it("tolerates null and undefined carriers", () => {
    expect(getShotEvents(null)).toEqual([])
    expect(getShotEvents(undefined)).toEqual([])
  })
})