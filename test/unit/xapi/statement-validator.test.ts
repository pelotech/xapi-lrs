import { describe, it, expect } from "vitest";
import { validateStatement } from "../../../src/xapi/statement-validator.ts";

const VALID_STMT = {
  actor: { mbox: "mailto:test@example.com" },
  verb: { id: "http://example.com/verbs/completed", display: { "en-US": "completed" } },
  object: { id: "http://example.com/activities/1", objectType: "Activity" },
};

describe("validateStatement", () => {
  it("accepts a minimal valid statement", () => {
    const result = validateStatement(VALID_STMT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.statement.actor).toMatchObject({ mbox: "mailto:test@example.com" });
      expect(result.statement.id).toBeDefined();
      expect(result.statement.timestamp).toBeDefined();
    }
  });

  it("preserves client-provided id and timestamp", () => {
    const stmt = {
      ...VALID_STMT,
      id: "12345678-1234-1234-1234-123456789abc",
      timestamp: "2024-01-01T00:00:00Z",
    };
    const result = validateStatement(stmt);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.statement.id).toBe("12345678-1234-1234-1234-123456789abc");
      expect(result.statement.timestamp).toBe("2024-01-01T00:00:00Z");
    }
  });

  it("rejects a non-object input", () => {
    const result = validateStatement("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].message).toContain("JSON object");
    }
  });

  it("rejects missing actor", () => {
    const result = validateStatement({ verb: VALID_STMT.verb, object: VALID_STMT.object });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "actor")).toBe(true);
    }
  });

  it("rejects missing verb", () => {
    const result = validateStatement({ actor: VALID_STMT.actor, object: VALID_STMT.object });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "verb")).toBe(true);
    }
  });

  it("rejects missing object", () => {
    const result = validateStatement({ actor: VALID_STMT.actor, verb: VALID_STMT.verb });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "object")).toBe(true);
    }
  });

  it("rejects invalid UUID for id", () => {
    const result = validateStatement({ ...VALID_STMT, id: "not-a-uuid" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "id")).toBe(true);
    }
  });

  it("rejects invalid verb id (not an IRI)", () => {
    const result = validateStatement({
      ...VALID_STMT,
      verb: { id: "no-scheme", display: { "en-US": "test" } },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "verb.id")).toBe(true);
    }
  });

  it("rejects agent with no IFI", () => {
    const result = validateStatement({
      ...VALID_STMT,
      actor: { name: "Someone" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("IFI"))).toBe(true);
    }
  });

  it("rejects agent with multiple IFIs", () => {
    const result = validateStatement({
      ...VALID_STMT,
      actor: { mbox: "mailto:a@b.com", openid: "http://example.com/openid" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("multiple"))).toBe(true);
    }
  });

  it("validates score.scaled range", () => {
    const result = validateStatement({
      ...VALID_STMT,
      result: { score: { scaled: 1.5 } },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "result.score.scaled")).toBe(true);
    }
  });

  it("rejects null values (except in extensions)", () => {
    const result = validateStatement({
      ...VALID_STMT,
      result: { response: null },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("Null"))).toBe(true);
    }
  });

  it("allows null values inside extensions", () => {
    const result = validateStatement({
      ...VALID_STMT,
      result: { extensions: { "http://example.com/ext": null } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateStatement({ ...VALID_STMT, foo: "bar" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("Unknown property"))).toBe(true);
    }
  });

  it("validates SubStatement object", () => {
    const result = validateStatement({
      ...VALID_STMT,
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:sub@example.com" },
        verb: { id: "http://example.com/verbs/did" },
        object: { id: "http://example.com/activities/sub" },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects nested SubStatements", () => {
    const result = validateStatement({
      ...VALID_STMT,
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:sub@example.com" },
        verb: { id: "http://example.com/verbs/did" },
        object: {
          objectType: "SubStatement",
          actor: { mbox: "mailto:deep@example.com" },
          verb: { id: "http://example.com/verbs/did" },
          object: { id: "http://example.com/activities/deep" },
        },
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.message.includes("nested SubStatement"))).toBe(true);
    }
  });

  it("strips stored and authority from output", () => {
    const result = validateStatement({
      ...VALID_STMT,
      stored: "2024-01-01T00:00:00Z",
      authority: { mbox: "mailto:auth@example.com" },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      const stmt = result.statement as unknown as Record<string, unknown>;
      expect(stmt.stored).toBeUndefined();
      expect(stmt.authority).toBeUndefined();
    }
  });

  it("validates version format", () => {
    const valid = validateStatement({ ...VALID_STMT, version: "1.0.3" });
    expect(valid.valid).toBe(true);

    const invalid = validateStatement({ ...VALID_STMT, version: "2.0.0" });
    expect(invalid.valid).toBe(false);
  });
});
