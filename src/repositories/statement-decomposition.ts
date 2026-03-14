/**
 * Statement decomposition helpers.
 *
 * Extract actors and activities from a validated statement for normalized
 * storage in junction tables. Also handles building the final payload
 * with server-set fields (stored, authority).
 */

import { canonicalAgentIfi, agentActorType } from "../helpers/agent.ts";

// ============================================================================
// Types
// ============================================================================

export type ActorEntry = {
  ifi: string;
  type: "Agent" | "Group";
  usage: string;
  payload: Record<string, unknown>;
};

export type ActivityEntry = {
  iri: string;
  usage: string;
  payload: Record<string, unknown>;
};

// ============================================================================
// Payload construction
// ============================================================================

/** Bake stored timestamp and authority into the payload before storing. */
export function buildPayload(
  statement: Record<string, unknown>,
  storedIso: string,
  authority: Record<string, unknown>,
): Record<string, unknown> {
  return { ...statement, stored: storedIso, authority };
}

/** Build a minimal actor payload for storage (just name if present). */
export function actorPayload(agent: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (agent.name) p.name = agent.name;
  return p;
}

// ============================================================================
// Actor extraction
// ============================================================================

/** Extract actors from a statement for junction table insertion. */
export function extractActors(stmt: Record<string, unknown>): ActorEntry[] {
  const actors: ActorEntry[] = [];

  function tryPush(agent: Record<string, unknown>, type: "Agent" | "Group", usage: string): void {
    try {
      actors.push({ ifi: canonicalAgentIfi(agent), type, usage, payload: actorPayload(agent) });
    } catch {
      /* skip agents without valid IFI */
    }
  }

  const actor = stmt.actor as Record<string, unknown> | undefined;
  if (actor) {
    tryPush(actor, agentActorType(actor), "Actor");
    if (Array.isArray(actor.member)) {
      for (const m of actor.member as Record<string, unknown>[]) {
        tryPush(m, "Agent", "Member");
      }
    }
  }

  const obj = stmt.object as Record<string, unknown> | undefined;
  if (obj) {
    const objectType = obj.objectType as string | undefined;
    if (objectType === "Agent" || objectType === "Group") {
      tryPush(obj, agentActorType(obj), "Object");
    }
  }

  const authority = stmt.authority as Record<string, unknown> | undefined;
  if (authority) {
    tryPush(authority, agentActorType(authority), "Authority");
    if (Array.isArray(authority.member)) {
      for (const m of authority.member as Record<string, unknown>[]) {
        tryPush(m, "Agent", "Authority");
      }
    }
  }

  const ctx = stmt.context as Record<string, unknown> | undefined;
  if (ctx) {
    const instructor = ctx.instructor as Record<string, unknown> | undefined;
    if (instructor) tryPush(instructor, agentActorType(instructor), "Instructor");
    const team = ctx.team as Record<string, unknown> | undefined;
    if (team) {
      tryPush(team, agentActorType(team), "Team");
      if (Array.isArray(team.member)) {
        for (const m of team.member as Record<string, unknown>[]) {
          tryPush(m, "Agent", "Member");
        }
      }
    }
  }

  // SubStatement actors
  if (obj && (obj.objectType as string) === "SubStatement") {
    const subActor = obj.actor as Record<string, unknown> | undefined;
    if (subActor) tryPush(subActor, agentActorType(subActor), "Actor");
    const subObj = obj.object as Record<string, unknown> | undefined;
    if (subObj && (subObj.objectType === "Agent" || subObj.objectType === "Group")) {
      tryPush(subObj, agentActorType(subObj), "Object");
    }
  }

  return actors;
}

// ============================================================================
// Activity extraction
// ============================================================================

/** Extract activities from a statement for junction table insertion. */
export function extractActivities(stmt: Record<string, unknown>): ActivityEntry[] {
  const activities: ActivityEntry[] = [];

  const obj = stmt.object as Record<string, unknown> | undefined;
  if (obj) {
    const objectType = (obj.objectType as string | undefined) ?? "Activity";
    if (objectType === "Activity" && obj.id) {
      activities.push({ iri: obj.id as string, usage: "Object", payload: obj });
    }
  }

  const ctx = stmt.context as Record<string, unknown> | undefined;
  if (ctx?.contextActivities && typeof ctx.contextActivities === "object") {
    const ca = ctx.contextActivities as Record<string, unknown>;
    const usageMap: Record<string, string> = {
      parent: "Parent",
      grouping: "Grouping",
      category: "Category",
      other: "Other",
    };
    for (const [key, usage] of Object.entries(usageMap)) {
      if (Array.isArray(ca[key])) {
        for (const a of ca[key] as Record<string, unknown>[]) {
          if (a.id) {
            activities.push({ iri: a.id as string, usage, payload: a });
          }
        }
      }
    }
  }

  // SubStatement activities
  if (obj && (obj.objectType as string) === "SubStatement") {
    const subObj = obj.object as Record<string, unknown> | undefined;
    const subObjType = (subObj?.objectType as string | undefined) ?? "Activity";
    if (subObj && subObjType === "Activity" && subObj.id) {
      activities.push({ iri: subObj.id as string, usage: "SubObject", payload: subObj });
    }

    const subCtx = obj.context as Record<string, unknown> | undefined;
    if (subCtx?.contextActivities && typeof subCtx.contextActivities === "object") {
      const sca = subCtx.contextActivities as Record<string, unknown>;
      const subUsageMap: Record<string, string> = {
        parent: "SubParent",
        grouping: "SubGrouping",
        category: "SubCategory",
        other: "SubOther",
      };
      for (const [key, usage] of Object.entries(subUsageMap)) {
        if (Array.isArray(sca[key])) {
          for (const a of sca[key] as Record<string, unknown>[]) {
            if (a.id) {
              activities.push({ iri: a.id as string, usage, payload: a });
            }
          }
        }
      }
    }
  }

  return activities;
}
