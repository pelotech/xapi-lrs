/**
 * Canonical IFI (Inverse Functional Identifier) string for an Agent.
 *
 * Used as a stable, deterministic key for indexing agents in the database.
 * The spec guarantees exactly one IFI per Agent or Identified Group.
 */

import crypto from 'node:crypto';
import type { Actor, Agent, IFI } from './types.js';

/**
 * Extract a canonical IFI string from an Agent.
 *
 * Returns a deterministic string that uniquely identifies the agent:
 *   - mbox:mailto:user@example.com
 *   - mbox_sha1sum:abc123...
 *   - openid:https://example.com/user
 *   - account:homePage|name
 *
 * Throws if the agent has no identifiable IFI.
 */
export function agentToIfi(agent: Agent): string {
  if (agent.mbox) return `mbox:${agent.mbox}`;
  if (agent.mbox_sha1sum) return `mbox_sha1sum:${agent.mbox_sha1sum}`;
  if (agent.openid) return `openid:${agent.openid}`;
  if (agent.account) return `account:${agent.account.homePage}|${agent.account.name}`;
  throw new Error('Agent has no inverse functional identifier');
}

/**
 * Extract a canonical IFI string from an Actor (Agent or Group).
 *
 * - Agent / Identified Group: returns the IFI string.
 * - Anonymous Group (no IFI, only member[]): returns null.
 */
export function actorToIfi(actor: Actor): string | null {
  if (actor.objectType === 'Group') {
    // IdentifiedGroup extends IFI — check IFI fields directly
    const ifi = actor as IFI;
    if (ifi.mbox || ifi.mbox_sha1sum || ifi.openid || ifi.account) {
      return ifiToString(ifi);
    }
    return null;
  }
  return agentToIfi(actor as Agent);
}

function ifiToString(ifi: IFI): string {
  if (ifi.mbox) return `mbox:${ifi.mbox}`;
  if (ifi.mbox_sha1sum) return `mbox_sha1sum:${ifi.mbox_sha1sum}`;
  if (ifi.openid) return `openid:${ifi.openid}`;
  if (ifi.account) return `account:${ifi.account.homePage}|${ifi.account.name}`;
  throw new Error('IFI has no inverse functional identifier');
}

/**
 * Compute ETag for a document from its content.
 * Per xAPI spec: SHA-1 digest, lowercase hex, quoted.
 */
export function computeEtag(content: Buffer): string {
  const hash = crypto.createHash('sha1').update(content).digest('hex');
  return `"${hash}"`;
}
