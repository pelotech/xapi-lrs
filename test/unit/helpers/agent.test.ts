import { describe, it, expect } from "vitest";
import {
  canonicalAgentIfi,
  agentActorType,
  validateSince,
  validateRegistration,
} from "../../../src/helpers/agent.ts";

describe("canonicalAgentIfi", () => {
  it("formats mbox IFI", () => {
    expect(canonicalAgentIfi({ mbox: "mailto:x@y.com" })).toBe("mbox::mailto:x@y.com");
  });

  it("formats mbox_sha1sum IFI", () => {
    expect(canonicalAgentIfi({ mbox_sha1sum: "abc123" })).toBe("mbox_sha1sum::abc123");
  });

  it("formats openid IFI", () => {
    expect(canonicalAgentIfi({ openid: "http://example.com/user" })).toBe(
      "openid::http://example.com/user",
    );
  });

  it("formats account IFI", () => {
    expect(canonicalAgentIfi({ account: { homePage: "http://example.com", name: "jdoe" } })).toBe(
      "account::jdoe@http://example.com",
    );
  });

  it("parses JSON string input", () => {
    const json = JSON.stringify({ mbox: "mailto:x@y.com" });
    expect(canonicalAgentIfi(json)).toBe("mbox::mailto:x@y.com");
  });

  it("throws 400 for invalid JSON string", () => {
    expect(() => canonicalAgentIfi("not json")).toThrow("not valid JSON");
  });

  it("throws 400 for agent with no IFI", () => {
    expect(() => canonicalAgentIfi({ name: "Someone" })).toThrow("exactly one IFI");
  });

  it("throws 400 for agent with multiple IFIs", () => {
    expect(() =>
      canonicalAgentIfi({ mbox: "mailto:a@b.com", openid: "http://example.com" }),
    ).toThrow("exactly one IFI");
  });

  it("throws 400 for account missing homePage or name", () => {
    expect(() => canonicalAgentIfi({ account: { homePage: "http://example.com" } })).toThrow(
      "homePage and name",
    );
  });
});

describe("agentActorType", () => {
  it('returns "Agent" when no objectType', () => {
    expect(agentActorType({ mbox: "mailto:a@b.com" })).toBe("Agent");
  });

  it('returns "Agent" when objectType is Agent', () => {
    expect(agentActorType({ objectType: "Agent", mbox: "mailto:a@b.com" })).toBe("Agent");
  });

  it('returns "Group" when objectType is Group', () => {
    expect(agentActorType({ objectType: "Group" })).toBe("Group");
  });
});

describe("validateSince", () => {
  it("accepts valid ISO 8601", () => {
    expect(validateSince("2024-01-01T00:00:00Z")).toBe("2024-01-01T00:00:00Z");
  });

  it("throws for garbage string", () => {
    expect(() => validateSince("not-a-date")).toThrow("ISO 8601");
  });

  it("passes undefined through", () => {
    expect(validateSince(undefined)).toBeUndefined();
  });
});

describe("validateRegistration", () => {
  it("accepts valid UUID", () => {
    expect(validateRegistration("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("throws for non-UUID", () => {
    expect(() => validateRegistration("not-a-uuid")).toThrow("UUID");
  });

  it("passes undefined through", () => {
    expect(validateRegistration(undefined)).toBeUndefined();
  });
});
