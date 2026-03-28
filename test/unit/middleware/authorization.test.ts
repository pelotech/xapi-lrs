import { describe, it, expect } from "vitest";
import { requiredScopes, hasScope } from "../../../src/middleware/authorization.ts";

// ---------------------------------------------------------------------------
// requiredScopes
// ---------------------------------------------------------------------------

describe("requiredScopes", () => {
  it("GET /xapi/statements requires statements/read", () => {
    const rule = requiredScopes("/xapi/statements", "GET");
    expect(rule).not.toBeNull();
    expect(rule!.scopes).toContain("statements/read");
  });

  it("POST /xapi/statements requires statements/write", () => {
    const rule = requiredScopes("/xapi/statements", "POST");
    expect(rule).not.toBeNull();
    expect(rule!.scopes).toContain("statements/write");
  });

  it("PUT /xapi/statements requires statements/write", () => {
    const rule = requiredScopes("/xapi/statements", "PUT");
    expect(rule!.scopes).toContain("statements/write");
  });

  it("PUT /xapi/activities/state requires state scope", () => {
    const rule = requiredScopes("/xapi/activities/state", "PUT");
    expect(rule!.scopes).toContain("state");
  });

  it("GET /xapi/agents/profile requires profile scope", () => {
    const rule = requiredScopes("/xapi/agents/profile", "GET");
    expect(rule!.scopes).toContain("profile");
  });

  it("returns null for unknown path", () => {
    expect(requiredScopes("/unknown", "GET")).toBeNull();
  });

  it("returns null for /xapi/about (public)", () => {
    // /xapi/about is handled by PUBLIC_PATHS in middleware, requiredScopes returns null
    expect(requiredScopes("/xapi/about", "GET")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasScope
// ---------------------------------------------------------------------------

describe("hasScope", () => {
  it('"all" matches when "all" is in the required list', () => {
    // hasScope does a simple includes check — "all" must be listed as an accepted scope
    // requiredScopes always includes "all" in every rule
    const stmtRead = requiredScopes("/xapi/statements", "GET")!;
    const stmtWrite = requiredScopes("/xapi/statements", "POST")!;
    const state = requiredScopes("/xapi/activities/state", "PUT")!;
    expect(hasScope(["all"], stmtRead.scopes)).toBe(true);
    expect(hasScope(["all"], stmtWrite.scopes)).toBe(true);
    expect(hasScope(["all"], state.scopes)).toBe(true);
  });

  it('"all/read" matches read scopes when listed as required', () => {
    // all/read is in the required list for GET endpoints
    expect(hasScope(["all/read"], ["statements/read", "all/read", "all"])).toBe(true);
  });

  it('"all/read" does not match write-only scopes', () => {
    expect(hasScope(["all/read"], ["statements/write", "all"])).toBe(false);
  });

  it("exact scope match works", () => {
    expect(hasScope(["statements/read"], ["statements/read"])).toBe(true);
  });

  it("mismatched scope fails", () => {
    expect(hasScope(["statements/read"], ["statements/write"])).toBe(false);
  });

  it("statements/read/mine matches when in required list", () => {
    expect(
      hasScope(
        ["statements/read/mine"],
        ["statements/read", "statements/read/mine", "all/read", "all"],
      ),
    ).toBe(true);
  });

  it("empty granted returns false", () => {
    expect(hasScope([], ["statements/read"])).toBe(false);
  });
});
