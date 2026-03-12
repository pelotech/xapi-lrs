/**
 * xAPI 1.0.3 Statement Types
 *
 * Full type hierarchy for generic xAPI statements per the xAPI 1.0.3 Data spec.
 * These types are used by both the LRS service and the API service for statement
 * validation, storage, and API responses.
 *
 * Note: The registration machine in packages/api uses a simplified subset of these
 * types (in registration-machine/types.ts) that encode CMI5-specific constraints
 * (e.g. actor always has account IFI, context.registration is required).
 */

// ============================================================================
// Inverse Functional Identifiers (IFIs)
// ============================================================================

export interface AccountIFI {
  homePage: string;
  name: string;
}

// ============================================================================
// Agent — exactly one IFI required
// ============================================================================

interface XAPIAgentBase {
  objectType?: "Agent";
  name?: string;
}

export interface XAPIAgentAccount extends XAPIAgentBase {
  account: AccountIFI;
  mbox?: undefined;
  mbox_sha1sum?: undefined;
  openid?: undefined;
}

export interface XAPIAgentMbox extends XAPIAgentBase {
  mbox: string;
  account?: undefined;
  mbox_sha1sum?: undefined;
  openid?: undefined;
}

export interface XAPIAgentSha1 extends XAPIAgentBase {
  mbox_sha1sum: string;
  account?: undefined;
  mbox?: undefined;
  openid?: undefined;
}

export interface XAPIAgentOpenid extends XAPIAgentBase {
  openid: string;
  account?: undefined;
  mbox?: undefined;
  mbox_sha1sum?: undefined;
}

export type XAPIAgent = XAPIAgentAccount | XAPIAgentMbox | XAPIAgentSha1 | XAPIAgentOpenid;

// ============================================================================
// Group — Anonymous (member required, no IFI) or Identified (one IFI required)
// ============================================================================

interface XAPIGroupBase {
  objectType: "Group";
  name?: string;
}

export interface XAPIAnonymousGroup extends XAPIGroupBase {
  member: XAPIAgent[];
  account?: undefined;
  mbox?: undefined;
  mbox_sha1sum?: undefined;
  openid?: undefined;
}

export interface XAPIIdentifiedGroupAccount extends XAPIGroupBase {
  account: AccountIFI;
  member?: XAPIAgent[];
  mbox?: undefined;
  mbox_sha1sum?: undefined;
  openid?: undefined;
}

export interface XAPIIdentifiedGroupMbox extends XAPIGroupBase {
  mbox: string;
  member?: XAPIAgent[];
  account?: undefined;
  mbox_sha1sum?: undefined;
  openid?: undefined;
}

export interface XAPIIdentifiedGroupSha1 extends XAPIGroupBase {
  mbox_sha1sum: string;
  member?: XAPIAgent[];
  account?: undefined;
  mbox?: undefined;
  openid?: undefined;
}

export interface XAPIIdentifiedGroupOpenid extends XAPIGroupBase {
  openid: string;
  member?: XAPIAgent[];
  account?: undefined;
  mbox?: undefined;
  mbox_sha1sum?: undefined;
}

export type XAPIIdentifiedGroup =
  | XAPIIdentifiedGroupAccount
  | XAPIIdentifiedGroupMbox
  | XAPIIdentifiedGroupSha1
  | XAPIIdentifiedGroupOpenid;

export type XAPIGroup = XAPIAnonymousGroup | XAPIIdentifiedGroup;

export type XAPIActor = XAPIAgent | XAPIGroup;

// ============================================================================
// Verb
// ============================================================================

export interface XAPIVerb {
  id: string;
  display?: Record<string, string>;
}

// ============================================================================
// Activity Definition
// ============================================================================

export interface XAPIInteractionComponent {
  id: string;
  description?: Record<string, string>;
}

export interface XAPIActivityDefinition {
  name?: Record<string, string>;
  description?: Record<string, string>;
  type?: string;
  moreInfo?: string;
  interactionType?: string;
  correctResponsesPattern?: string[];
  choices?: XAPIInteractionComponent[];
  scale?: XAPIInteractionComponent[];
  source?: XAPIInteractionComponent[];
  target?: XAPIInteractionComponent[];
  steps?: XAPIInteractionComponent[];
  extensions?: Record<string, unknown>;
}

// ============================================================================
// Object variants
// ============================================================================

export interface XAPIActivity {
  objectType?: "Activity";
  id: string;
  definition?: XAPIActivityDefinition;
}

export interface XAPIStatementRef {
  objectType: "StatementRef";
  id: string;
}

export interface XAPISubStatement {
  objectType: "SubStatement";
  actor: XAPIActor;
  verb: XAPIVerb;
  object: XAPIActivity | XAPIAgent | XAPIGroup | XAPIStatementRef;
  result?: XAPIResult;
  context?: XAPIContext;
  timestamp?: string;
  attachments?: XAPIAttachmentMeta[];
}

/** Agent or Group when used as statement object (objectType required) */
export interface XAPIAgentObject {
  objectType: "Agent";
  name?: string;
  account?: AccountIFI;
  mbox?: string;
  mbox_sha1sum?: string;
  openid?: string;
}

export interface XAPIGroupObject {
  objectType: "Group";
  name?: string;
  account?: AccountIFI;
  mbox?: string;
  mbox_sha1sum?: string;
  openid?: string;
  member?: XAPIAgent[];
}

export type XAPIObject =
  | XAPIActivity
  | XAPIStatementRef
  | XAPISubStatement
  | XAPIAgentObject
  | XAPIGroupObject;

// ============================================================================
// Result
// ============================================================================

export interface XAPIScore {
  scaled?: number;
  raw?: number;
  min?: number;
  max?: number;
}

export interface XAPIResult {
  score?: XAPIScore;
  success?: boolean;
  completion?: boolean;
  response?: string;
  duration?: string;
  extensions?: Record<string, unknown>;
}

// ============================================================================
// Context
// ============================================================================

export interface XAPIContextActivities {
  parent?: XAPIActivity[];
  grouping?: XAPIActivity[];
  category?: XAPIActivity[];
  other?: XAPIActivity[];
}

export interface XAPIContext {
  registration?: string;
  instructor?: XAPIAgent | XAPIGroup;
  team?: XAPIGroup;
  contextActivities?: XAPIContextActivities;
  revision?: string;
  platform?: string;
  language?: string;
  statement?: XAPIStatementRef;
  extensions?: Record<string, unknown>;
}

// ============================================================================
// Attachment metadata
// ============================================================================

export interface XAPIAttachmentMeta {
  usageType: string;
  display: Record<string, string>;
  description?: Record<string, string>;
  contentType: string;
  length: number;
  sha2: string;
  fileUrl?: string;
}

// ============================================================================
// Statement (input vs. validated)
// ============================================================================

/** Raw statement input — id and timestamp are optional (server generates if missing) */
export interface XAPIStatementInput {
  id?: string;
  actor: XAPIActor;
  verb: XAPIVerb;
  object: XAPIObject;
  result?: XAPIResult;
  context?: XAPIContext;
  timestamp?: string;
  authority?: XAPIActor;
  version?: string;
  attachments?: XAPIAttachmentMeta[];
}

/** Validated statement — id and timestamp guaranteed present after validation */
export interface XAPIValidatedStatement {
  id: string;
  actor: XAPIActor;
  verb: XAPIVerb;
  object: XAPIObject;
  result?: XAPIResult;
  context?: XAPIContext;
  timestamp: string;
  authority?: XAPIActor;
  version?: string;
  attachments?: XAPIAttachmentMeta[];
}
