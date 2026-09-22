import { afterEach, describe, expect, test } from "bun:test";
import {
  SERVICE_HEADERS,
  verifyServiceIdentity,
} from "../src/lib/serviceGuard";

const TOKEN = "test-service-token";
const SUB = "auth0|user-123";

function setToken(value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).SERVICE_TOKEN;
  } else {
    process.env.SERVICE_TOKEN = value;
  }
}

afterEach(() => {
  setToken(undefined);
});

describe("verifyServiceIdentity", () => {
  test("allows requests when the guard is disabled (no SERVICE_TOKEN)", () => {
    setToken(undefined);
    expect(verifyServiceIdentity(null, null, "auth0|someone")).toEqual({
      ok: true,
    });
  });

  test("rejects missing service token when enabled", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(null, SUB, SUB);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.status).toBe(403);
    expect(outcome.body.code).toBe("FORBIDDEN");
  });

  test("rejects a wrong service token when enabled", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity("wrong-token", SUB, SUB);
    expect(outcome.ok).toBe(false);
  });

  test("rejects a missing verified id", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(TOKEN, null, SUB);
    expect(outcome.ok).toBe(false);
  });

  test("rejects a verified id that does not match the resource owner", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(TOKEN, "auth0|other-user", SUB);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.body.code).toBe("FORBIDDEN");
  });

  test("rejects when the resource owner is unknown", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(TOKEN, SUB, undefined);
    expect(outcome.ok).toBe(false);
  });

  test("allows a matching verified identity when enabled", () => {
    setToken(TOKEN);
    expect(verifyServiceIdentity(TOKEN, SUB, SUB)).toEqual({ ok: true });
  });

  test("allows self-scoped routes with only the verified identity", () => {
    setToken(TOKEN);
    expect(
      verifyServiceIdentity(TOKEN, SUB, undefined, { self: true }),
    ).toEqual({
      ok: true,
    });
  });

  test("rejects self-scoped routes without a verified identity", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(TOKEN, null, undefined, {
      self: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.status).toBe(403);
  });

  test("reads the expected header names", () => {
    expect(SERVICE_HEADERS.token).toBe("x-service-token");
    expect(SERVICE_HEADERS.verifiedAuth0Id).toBe("x-verified-auth0-id");
  });

  test("allows a non-owner with an active org membership (memberRole given)", () => {
    setToken(TOKEN);
    expect(
      verifyServiceIdentity(TOKEN, "auth0|member-1", "auth0|owner-1", {
        memberRole: "coach",
      }),
    ).toEqual({ ok: true });
  });

  test("denies a player-role member on /api/auth/user trees (allowedMemberRoles)", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(
      TOKEN,
      "auth0|member-1",
      "auth0|owner-1",
      {
        memberRole: "player",
        allowedMemberRoles: ["owner", "admin", "coach", "analyst"],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.status).toBe(403);
  });

  test("allows a coach-role member on /api/auth/user trees (allowedMemberRoles)", () => {
    setToken(TOKEN);
    expect(
      verifyServiceIdentity(TOKEN, "auth0|member-1", "auth0|owner-1", {
        memberRole: "coach",
        allowedMemberRoles: ["owner", "admin", "coach", "analyst"],
      }),
    ).toEqual({ ok: true });
  });

  test("player-role member without an allowlist still passes (org/email trees)", () => {
    setToken(TOKEN);
    expect(
      verifyServiceIdentity(TOKEN, "auth0|member-1", "auth0|owner-1", {
        memberRole: "player",
      }),
    ).toEqual({ ok: true });
  });

  test("rejects a non-owner with a null memberRole", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(
      TOKEN,
      "auth0|outsider",
      "auth0|owner-1",
      {
        memberRole: null,
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.body.code).toBe("FORBIDDEN");
  });

  test("still requires valid token even when memberRole is provided", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(
      "wrong-token",
      "auth0|member-1",
      "auth0|owner-1",
      {
        memberRole: "coach",
      },
    );
    expect(outcome.ok).toBe(false);
  });

  test("still requires a verified id even when memberRole is provided", () => {
    setToken(TOKEN);
    const outcome = verifyServiceIdentity(TOKEN, null, "auth0|owner-1", {
      memberRole: "coach",
    });
    expect(outcome.ok).toBe(false);
  });
});
