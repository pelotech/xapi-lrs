/**
 * Statement enrichment and format transformations.
 *
 * In the lrsql model, stored and authority are already baked into the payload
 * at insert time. enrichStatement just returns the payload directly.
 */

import type { XapiStatementRow } from "../repositories/statements.ts";

/** LRS authority home page — shared across all credential-derived authorities. */
export const LRS_AUTHORITY_HOME_PAGE = "https://xapi-lrs.pelotech.dev";

/** Build an xAPI authority agent from the authenticated account name. */
export function buildAuthority(accountName: string): Record<string, unknown> {
  return {
    objectType: "Agent",
    account: {
      homePage: LRS_AUTHORITY_HOME_PAGE,
      name: accountName,
    },
  };
}

/** Return the statement payload — stored/authority already inside. */
export function enrichStatement(row: XapiStatementRow): Record<string, unknown> {
  return row.payload;
}

/**
 * Apply xAPI format transformation to a statement.
 * - 'exact': return as-is (default)
 * - 'ids': strip Activity definitions, Verb display, reduce context Activities
 * - 'canonical': select single Language Map entry per Accept-Language header
 */
export function formatStatement(
  stmt: Record<string, unknown>,
  format: string,
  acceptLanguage?: string,
): Record<string, unknown> {
  if (format === "exact") return stmt;
  if (format === "ids") return formatIds(stmt);
  if (format === "canonical") return formatCanonical(stmt, acceptLanguage);
  return stmt;
}

function formatIds(stmt: Record<string, unknown>): Record<string, unknown> {
  const result = { ...stmt };

  if (result.verb && typeof result.verb === "object") {
    const verb = result.verb as Record<string, unknown>;
    result.verb = { id: verb.id };
  }

  result.actor = stripAgentToIfi(result.actor);

  const obj = result.object;
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    if (o.objectType === "Agent" || o.objectType === "Group") {
      result.object = stripAgentToIfi(obj);
    } else if (o.objectType === "SubStatement") {
      result.object = formatIdsSubStatement(o);
    } else {
      result.object = stripActivityDefinition(obj);
    }
  }

  if (result.context && typeof result.context === "object") {
    const ctx = { ...(result.context as Record<string, unknown>) };
    if (ctx.instructor) ctx.instructor = stripAgentToIfi(ctx.instructor);
    if (ctx.team) ctx.team = stripAgentToIfi(ctx.team);
    if (ctx.contextActivities && typeof ctx.contextActivities === "object") {
      const ca = { ...(ctx.contextActivities as Record<string, unknown>) };
      for (const key of ["parent", "grouping", "category", "other"] as const) {
        if (Array.isArray(ca[key])) {
          ca[key] = (ca[key] as Record<string, unknown>[]).map(stripActivityDefinition);
        }
      }
      ctx.contextActivities = ca;
    }
    result.context = ctx;
  }

  return result;
}

function formatIdsSubStatement(sub: Record<string, unknown>): Record<string, unknown> {
  const result = { ...sub };
  result.actor = stripAgentToIfi(result.actor);
  if (result.verb && typeof result.verb === "object") {
    result.verb = { id: (result.verb as Record<string, unknown>).id };
  }
  if (result.object) {
    const o = result.object as Record<string, unknown>;
    if (o.objectType === "Agent" || o.objectType === "Group") {
      result.object = stripAgentToIfi(result.object);
    } else {
      result.object = stripActivityDefinition(result.object);
    }
  }
  if (result.context && typeof result.context === "object") {
    const ctx = { ...(result.context as Record<string, unknown>) };
    if (ctx.instructor) ctx.instructor = stripAgentToIfi(ctx.instructor);
    if (ctx.team) ctx.team = stripAgentToIfi(ctx.team);
    if (ctx.contextActivities && typeof ctx.contextActivities === "object") {
      const ca = { ...(ctx.contextActivities as Record<string, unknown>) };
      for (const key of ["parent", "grouping", "category", "other"] as const) {
        if (Array.isArray(ca[key])) {
          ca[key] = (ca[key] as Record<string, unknown>[]).map(stripActivityDefinition);
        }
      }
      ctx.contextActivities = ca;
    }
    result.context = ctx;
  }
  return result;
}

function stripAgentToIfi(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const o = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (o.objectType) result.objectType = o.objectType;
  for (const ifi of ["mbox", "mbox_sha1sum", "openid", "account"] as const) {
    if (o[ifi] != null) {
      result[ifi] = o[ifi];
      break;
    }
  }
  if (Array.isArray(o.member)) {
    result.member = o.member.map(stripAgentToIfi);
  }
  return result;
}

function stripActivityDefinition(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const o = obj as Record<string, unknown>;
  if (o.objectType && o.objectType !== "Activity") return obj;
  if ("id" in o) return { id: o.id };
  return obj;
}

function formatCanonical(
  stmt: Record<string, unknown>,
  acceptLanguage?: string,
): Record<string, unknown> {
  const preferred = parseAcceptLanguage(acceptLanguage);
  const result = { ...stmt };

  result.verb = canonicalizeVerb(result.verb, preferred);

  if (result.object && typeof result.object === "object") {
    const o = result.object as Record<string, unknown>;
    if (o.objectType === "SubStatement") {
      result.object = canonicalizeSubStatement(o, preferred);
    } else {
      result.object = canonicalizeActivityLangMaps(result.object, preferred);
    }
  }

  result.context = canonicalizeContext(result.context, preferred);

  return result;
}

function canonicalizeVerb(verb: unknown, preferred: string[]): unknown {
  if (!verb || typeof verb !== "object") return verb;
  const v = { ...(verb as Record<string, unknown>) };
  if (v.display && typeof v.display === "object") {
    v.display = pickLanguage(v.display as Record<string, string>, preferred);
  }
  return v;
}

function canonicalizeContext(ctx: unknown, preferred: string[]): unknown {
  if (!ctx || typeof ctx !== "object") return ctx;
  const c = { ...(ctx as Record<string, unknown>) };
  if (c.contextActivities && typeof c.contextActivities === "object") {
    const ca = { ...(c.contextActivities as Record<string, unknown>) };
    for (const key of ["parent", "grouping", "category", "other"] as const) {
      if (Array.isArray(ca[key])) {
        ca[key] = (ca[key] as Record<string, unknown>[]).map((a: unknown) =>
          canonicalizeActivityLangMaps(a, preferred),
        );
      }
    }
    c.contextActivities = ca;
  }
  return c;
}

function canonicalizeSubStatement(
  sub: Record<string, unknown>,
  preferred: string[],
): Record<string, unknown> {
  const result = { ...sub };
  result.verb = canonicalizeVerb(result.verb, preferred);
  if (result.object) {
    result.object = canonicalizeActivityLangMaps(result.object, preferred);
  }
  result.context = canonicalizeContext(result.context, preferred);
  return result;
}

function canonicalizeActivityLangMaps(obj: unknown, preferred: string[]): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const o = obj as Record<string, unknown>;
  if (o.objectType && o.objectType !== "Activity") return obj;
  if (!o.definition || typeof o.definition !== "object") return obj;

  const def = { ...(o.definition as Record<string, unknown>) };
  for (const key of ["name", "description"] as const) {
    if (def[key] && typeof def[key] === "object") {
      def[key] = pickLanguage(def[key] as Record<string, string>, preferred);
    }
  }
  return { ...o, definition: def };
}

function parseAcceptLanguage(header?: string): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

function pickLanguage(
  langMap: Record<string, string>,
  preferred: string[],
): Record<string, string> {
  const keys = Object.keys(langMap);
  if (keys.length <= 1) return langMap;

  for (const pref of preferred) {
    const exact = keys.find((k) => k.toLowerCase() === pref);
    if (exact) return { [exact]: langMap[exact] };

    const prefix = keys.find((k) => k.toLowerCase().startsWith(pref + "-"));
    if (prefix) return { [prefix]: langMap[prefix] };

    const parentTag = pref.split("-")[0];
    if (parentTag !== pref) {
      const parent = keys.find((k) => k.toLowerCase() === parentTag);
      if (parent) return { [parent]: langMap[parent] };
    }
  }

  return { [keys[0]]: langMap[keys[0]] };
}
