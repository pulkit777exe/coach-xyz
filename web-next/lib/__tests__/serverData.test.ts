import { describe, expect, test } from "vitest";
import { resolveOrgContext } from "../serverData";

type Org = { org_auth0_id: string; role: "owner" | "admin" | "coach" | "player" };

describe("resolveOrgContext", () => {
  const OWNER = "auth0|owner-1";
  const MEMBER = "auth0|member-1";

  test("owner-of-self wins even when also a member elsewhere", () => {
    const orgs: Org[] = [
      { org_auth0_id: "auth0|other-org", role: "coach" },
      { org_auth0_id: OWNER, role: "owner" },
    ];
    expect(resolveOrgContext(OWNER, orgs)).toEqual({ auth0Id: OWNER, role: "owner" });
  });

  test("an invited member resolves to their first active membership", () => {
    const orgs: Org[] = [
      { org_auth0_id: OWNER, role: "coach" },
      { org_auth0_id: "auth0|second-org", role: "player" },
    ];
    expect(resolveOrgContext(MEMBER, orgs)).toEqual({ auth0Id: OWNER, role: "coach" });
  });

  test("empty memberships fall back to owner-of-self (fresh coach)", () => {
    expect(resolveOrgContext(MEMBER, [])).toEqual({ auth0Id: MEMBER, role: "owner" });
  });

  test("missing session sub with empty memberships yields empty auth0Id", () => {
    expect(resolveOrgContext(undefined, [])).toEqual({ auth0Id: "", role: "owner" });
  });

  test("cookie preference wins when it names a real membership", () => {
    const orgs: Org[] = [
      { org_auth0_id: OWNER, role: "owner" },
      { org_auth0_id: "auth0|other-org", role: "coach" },
    ];
    // Owner's default is own org, but cookie points at other-org.
    expect(resolveOrgContext(OWNER, orgs, "auth0|other-org")).toEqual({
      auth0Id: "auth0|other-org",
      role: "coach",
    });
  });

  test("cookie preference is ignored when it does not name a membership", () => {
    const orgs: Org[] = [{ org_auth0_id: OWNER, role: "coach" }];
    expect(resolveOrgContext(MEMBER, orgs, "auth0|unknown")).toEqual({
      auth0Id: OWNER,
      role: "coach",
    });
  });

  test("cookie preference picks second org for an owner with two memberships", () => {
    const A = "auth0|org-a";
    const B = "auth0|org-b";
    const orgs: Org[] = [
      { org_auth0_id: A, role: "owner" },
      { org_auth0_id: B, role: "admin" },
    ];
    expect(resolveOrgContext(A, orgs, B)).toEqual({ auth0Id: B, role: "admin" });
  });

  test("null/empty cookie falls back to owner-of-self", () => {
    const orgs: Org[] = [{ org_auth0_id: OWNER, role: "owner" }];
    expect(resolveOrgContext(OWNER, orgs, null)).toEqual({ auth0Id: OWNER, role: "owner" });
    expect(resolveOrgContext(OWNER, orgs, "")).toEqual({ auth0Id: OWNER, role: "owner" });
  });
});