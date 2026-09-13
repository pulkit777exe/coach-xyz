import { describe, expect, test } from "bun:test"
import { ENGINE_PIPELINE_STATES } from "../src/types"

// The engine owns the state machine (engine/core/jobs.py STATE_FLOW). This
// test pins the wire contract so a rename/removal in any layer fails here
// instead of silently mis-mapping states in the UI.
const CANONICAL_FORWARD_FLOW = [
  "uploading",
  "scanning",
  "player_selection",
  "analyzing",
  "rendering",
  "completed",
]

describe("pipeline state contract", () => {
  test("engine forward flow matches the canonical order", () => {
    expect(ENGINE_PIPELINE_STATES.filter((s) => s !== "failed")).toEqual(
      CANONICAL_FORWARD_FLOW,
    )
  })

  test("failed is a terminal state outside the forward flow", () => {
    expect(ENGINE_PIPELINE_STATES).toContain("failed")
    expect(ENGINE_PIPELINE_STATES[ENGINE_PIPELINE_STATES.length - 1]).toBe("failed")
  })

  test("union covers exactly the documented set", () => {
    expect(ENGINE_PIPELINE_STATES).toEqual([...CANONICAL_FORWARD_FLOW, "failed"])
  })
})