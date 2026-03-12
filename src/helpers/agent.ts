/**
 * Agent IFI parsing and parameter validation helpers.
 *
 * IFI format matches lrsql: "mbox::mailto:...", "mbox_sha1sum::...",
 * "openid::...", "account::name@homePage"
 */

import { HttpError } from "../db.ts";

/**
 * Parse agent JSON and return a canonical IFI string in lrsql format.
 *
 * Format: "mbox::mailto:..." | "mbox_sha1sum::..." | "openid::..." | "account::name@homePage"
 *
 * Throws 400 if the agent is not valid JSON or has no/multiple IFIs.
 */
export function canonicalAgentIfi(agent: string | Record<string, unknown>): string {
  let agentObj: Record<string, unknown>;
  if (typeof agent === "string") {
    try {
      agentObj = JSON.parse(agent) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Agent parameter is not valid JSON");
    }
  } else {
    agentObj = agent;
  }

  const ifiCount =
    (agentObj.mbox ? 1 : 0) +
    (agentObj.mbox_sha1sum ? 1 : 0) +
    (agentObj.openid ? 1 : 0) +
    (agentObj.account ? 1 : 0);

  if (ifiCount === 0) {
    throw new HttpError(
      400,
      "Agent must have exactly one IFI (mbox, mbox_sha1sum, openid, or account)",
    );
  }
  if (ifiCount > 1) {
    throw new HttpError(
      400,
      "Agent must have exactly one IFI (mbox, mbox_sha1sum, openid, or account)",
    );
  }

  if (agentObj.mbox) return `mbox::${agentObj.mbox}`;
  if (agentObj.mbox_sha1sum) return `mbox_sha1sum::${agentObj.mbox_sha1sum}`;
  if (agentObj.openid) return `openid::${agentObj.openid}`;

  const account = agentObj.account as { homePage?: string; name?: string };
  if (!account.homePage || !account.name) {
    throw new HttpError(400, "Agent account must have both homePage and name");
  }
  return `account::${account.name}@${account.homePage}`;
}

/**
 * Determine the actor_type for an agent/group object.
 */
export function agentActorType(agent: Record<string, unknown>): "Agent" | "Group" {
  return agent.objectType === "Group" ? "Group" : "Agent";
}

/** Validate `since` parameter as an ISO 8601 timestamp. Returns the value or throws 400. */
export function validateSince(since: string | undefined): string | undefined {
  if (!since) return since;
  const d = new Date(since);
  if (isNaN(d.getTime())) {
    throw new HttpError(400, "since parameter is not a valid ISO 8601 timestamp");
  }
  return since;
}

/** Validate `registration` parameter as a UUID. Returns the value or throws 400. */
export function validateRegistration(registration: string | undefined): string | undefined {
  if (!registration) return registration;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registration)) {
    throw new HttpError(400, "registration parameter is not a valid UUID");
  }
  return registration;
}
