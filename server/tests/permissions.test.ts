import { describe, expect, test } from "bun:test"

import {
  PERMISSIONS,
  canAccessTeam,
  hasPermission,
} from "../src/lib/permissions"

describe("hasPermission", () => {
  test("owner holds every permission", () => {
    for (const p of PERMISSIONS) {
      expect(hasPermission("owner", p)).toBe(true)
    }
  })

  test("admin holds everything except medical.read", () => {
    expect(hasPermission("admin", "medical.read")).toBe(false)
    expect(hasPermission("admin", "org.manage_members")).toBe(true)
    expect(hasPermission("admin", "analysis.create")).toBe(true)
  })

  test("coach can manage players and analyses but not members or medical", () => {
    expect(hasPermission("coach", "analysis.create")).toBe(true)
    expect(hasPermission("coach", "player.manage")).toBe(true)
    expect(hasPermission("coach", "finding.review")).toBe(true)
    expect(hasPermission("coach", "team.manage")).toBe(true)
    expect(hasPermission("coach", "team.create")).toBe(false)
    expect(hasPermission("coach", "org.manage_members")).toBe(false)
    expect(hasPermission("coach", "org.invite")).toBe(false)
    expect(hasPermission("coach", "medical.read")).toBe(false)
  })

  test("analyst analyzes and reports without membership management", () => {
    expect(hasPermission("analyst", "analysis.create")).toBe(true)
    expect(hasPermission("analyst", "report.create")).toBe(true)
    expect(hasPermission("analyst", "finding.review")).toBe(true)
    expect(hasPermission("analyst", "player.manage")).toBe(false)
    expect(hasPermission("analyst", "team.manage")).toBe(false)
  })

  test("medical reads team/player/report + medical only", () => {
    expect(hasPermission("medical", "medical.read")).toBe(true)
    expect(hasPermission("medical", "player.read")).toBe(true)
    expect(hasPermission("medical", "analysis.create")).toBe(false)
    expect(hasPermission("medical", "player.manage")).toBe(false)
  })

  test("player is read-only on own scope", () => {
    expect(hasPermission("player", "analysis.read")).toBe(true)
    expect(hasPermission("player", "report.read")).toBe(true)
    expect(hasPermission("player", "analysis.create")).toBe(false)
    expect(hasPermission("player", "team.read")).toBe(false)
  })

  test("null role holds nothing", () => {
    expect(hasPermission(null, "team.read")).toBe(false)
  })

  test("permission vocabulary has no duplicates", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})

describe("canAccessTeam", () => {
  test("owner and admin bypass team scope", () => {
    expect(canAccessTeam("owner", [], "team-1")).toBe(true)
    expect(canAccessTeam("admin", [], "team-1")).toBe(true)
  })

  test("coach/analyst/medical need a membership on that team", () => {
    expect(canAccessTeam("coach", ["team-1"], "team-1")).toBe(true)
    expect(canAccessTeam("coach", ["team-2"], "team-1")).toBe(false)
    expect(canAccessTeam("analyst", ["team-1"], "team-1")).toBe(true)
    expect(canAccessTeam("medical", ["team-1"], "team-1")).toBe(true)
    expect(canAccessTeam("medical", [], "team-1")).toBe(false)
  })

  test("player never passes team scope (self-scope only)", () => {
    expect(canAccessTeam("player", ["team-1"], "team-1")).toBe(false)
  })

  test("null role never passes", () => {
    expect(canAccessTeam(null, ["team-1"], "team-1")).toBe(false)
  })
})
