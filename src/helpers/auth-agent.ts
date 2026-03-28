/**
 * Helpers for deriving xAPI Agent objects and IFI strings from auth info.
 * Used by statements/read/mine scope enforcement.
 */

import type { AuthInfo } from "../auth/types.ts";
import type { XapiScope } from "../auth/types.ts";
import { LRS_AUTHORITY_HOME_PAGE } from "./enrichment.ts";

/**
 * Build an xAPI Agent object from the authenticated identity.
 * - Basic auth: Agent with account IFI using LRS home page + account name
 * - JWT auth: Agent with account IFI using issuer + sub
 */
export function agentFromAuth(auth: AuthInfo): Record<string, unknown> {
  if (auth.type === "basic") {
    return {
      objectType: "Agent",
      account: { homePage: LRS_AUTHORITY_HOME_PAGE, name: auth.payload.accountName },
    };
  }
  return {
    objectType: "Agent",
    account: { homePage: auth.payload.iss, name: auth.payload.sub },
  };
}

/**
 * Return a canonical IFI string for the authenticated identity.
 * Format: "account::name@homePage" (matches lrsql IFI convention)
 */
export function agentIfiFromAuth(auth: AuthInfo): string {
  if (auth.type === "basic") {
    return `account::${auth.payload.accountName}@${LRS_AUTHORITY_HOME_PAGE}`;
  }
  return `account::${auth.payload.sub}@${auth.payload.iss}`;
}

/** Broad read scopes that grant full statement read access. */
const FULL_READ_SCOPES: ReadonlyArray<XapiScope> = ["statements/read", "all/read", "all"];

/**
 * Check if the authenticated user only has statements/read/mine
 * (i.e., no broader read scope).
 */
export function hasOnlyMineScope(scopes: ReadonlyArray<XapiScope>): boolean {
  if (!scopes.includes("statements/read/mine")) return false;
  return !scopes.some((s) => FULL_READ_SCOPES.includes(s));
}
