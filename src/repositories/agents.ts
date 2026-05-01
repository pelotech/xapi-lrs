/**
 * xAPI Agent Repository — queries lrsql's actor table directly.
 */

import type { PoolClient } from 'pg';

// ============================================================================
// Types
// ============================================================================

export interface PersonObject {
  objectType: 'Person';
  name?: string[];
  mbox?: string[];
  mbox_sha1sum?: string[];
  openid?: string[];
  account?: Array<{ homePage: string; name: string }>;
}

// ============================================================================
// Query
// ============================================================================

/**
 * Build a Person Object from the actor + statement tables.
 * The actor table is deduplicated by IFI+type (one row per IFI), so we
 * parse IFI fields from it. Names are extracted from all statement payloads
 * where this agent appears, since the actor table only keeps the latest name.
 */
export async function getPersonObject(client: PoolClient, ifi: string): Promise<PersonObject | null> {
  const result = await client.query<{ actor_ifi: string; actor_type: string }>({
    name: 'get_person_by_ifi',
    text: `SELECT actor_ifi, actor_type FROM actor WHERE actor_ifi = $1`,
    values: [ifi],
  });

  if (result.rows.length === 0) return null;

  const person: PersonObject = { objectType: 'Person' };

  // Parse IFI back into xAPI fields
  // lrsql format: "mbox::mailto:...", "mbox_sha1sum::...", "openid::...", "account::name@homePage"
  for (const row of result.rows) {
    const actorIfi = row.actor_ifi;
    if (actorIfi.startsWith('mbox::')) {
      if (!person.mbox) person.mbox = [];
      person.mbox.push(actorIfi.slice(6));
    } else if (actorIfi.startsWith('mbox_sha1sum::')) {
      if (!person.mbox_sha1sum) person.mbox_sha1sum = [];
      person.mbox_sha1sum.push(actorIfi.slice(14));
    } else if (actorIfi.startsWith('openid::')) {
      if (!person.openid) person.openid = [];
      person.openid.push(actorIfi.slice(8));
    } else if (actorIfi.startsWith('account::')) {
      if (!person.account) person.account = [];
      const rest = actorIfi.slice(9);
      const atIdx = rest.indexOf('@');
      if (atIdx >= 0) {
        person.account.push({
          name: rest.slice(0, atIdx),
          homePage: rest.slice(atIdx + 1),
        });
      }
    }
  }

  // Extract all distinct names from statement payloads where this agent is the actor.
  // We query statement payloads rather than the actor table because the actor table
  // deduplicates by IFI and only keeps the last payload (ON CONFLICT DO UPDATE).
  const nameResult = await client.query<{ name: string }>({
    name: 'get_actor_names_from_stmts',
    text: `SELECT DISTINCT xs.payload -> 'actor' ->> 'name' AS name
           FROM statement_to_actor sta
           JOIN xapi_statement xs ON xs.statement_id = sta.statement_id
           WHERE sta.actor_ifi = $1
             AND sta.usage = 'Actor'
             AND xs.payload -> 'actor' ->> 'name' IS NOT NULL`,
    values: [ifi],
  });

  if (nameResult.rows.length > 0) {
    person.name = nameResult.rows.map((r) => r.name);
  }

  return person;
}
