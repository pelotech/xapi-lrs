/**
 * xAPI 1.0.3 Type Definitions
 *
 * Derived directly from the xAPI 1.0.3 specification:
 *   https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Data.md
 *   https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Communication.md
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** RFC 5646 language-tagged string map. Keys are language tags, values are human-readable strings. */
export type LanguageMap = Record<string, string>;

/** Open extension map. Keys are IRIs, values are arbitrary JSON. */
export type Extensions = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export interface Account {
  readonly homePage: string;
  readonly name: string;
}

/**
 * Inverse Functional Identifier — exactly one of these properties identifies an Agent or
 * Identified Group uniquely.
 */
export interface IFI {
  readonly mbox?: string;
  readonly mbox_sha1sum?: string;
  readonly openid?: string;
  readonly account?: Account;
}

export interface Agent extends IFI {
  readonly objectType?: 'Agent';
  readonly name?: string;
}

export interface AnonymousGroup {
  readonly objectType: 'Group';
  readonly name?: string;
  readonly member: readonly Agent[];
}

export interface IdentifiedGroup extends IFI {
  readonly objectType: 'Group';
  readonly name?: string;
  readonly member?: readonly Agent[];
}

export type Group = AnonymousGroup | IdentifiedGroup;
export type Actor = Agent | Group;

// ---------------------------------------------------------------------------
// Verb
// ---------------------------------------------------------------------------

export interface Verb {
  readonly id: string;
  readonly display?: LanguageMap;
}

// ---------------------------------------------------------------------------
// Activity & Definition
// ---------------------------------------------------------------------------

export type InteractionType =
  | 'true-false'
  | 'choice'
  | 'fill-in'
  | 'long-fill-in'
  | 'matching'
  | 'performance'
  | 'sequencing'
  | 'likert'
  | 'numeric'
  | 'other';

export interface InteractionComponent {
  readonly id: string;
  readonly description?: LanguageMap;
}

export interface ActivityDefinition {
  readonly name?: LanguageMap;
  readonly description?: LanguageMap;
  readonly type?: string;
  readonly moreInfo?: string;
  readonly interactionType?: InteractionType;
  readonly correctResponsesPattern?: readonly string[];
  readonly choices?: readonly InteractionComponent[];
  readonly scale?: readonly InteractionComponent[];
  readonly source?: readonly InteractionComponent[];
  readonly target?: readonly InteractionComponent[];
  readonly steps?: readonly InteractionComponent[];
  readonly extensions?: Extensions;
}

export interface Activity {
  readonly objectType?: 'Activity';
  readonly id: string;
  readonly definition?: ActivityDefinition;
}

// ---------------------------------------------------------------------------
// Statement Object variants
// ---------------------------------------------------------------------------

export interface StatementRef {
  readonly objectType: 'StatementRef';
  readonly id: string;
}

/**
 * A SubStatement is like a Statement but cannot be nested, and omits
 * id, stored, version, and authority.
 */
export interface SubStatement {
  readonly objectType: 'SubStatement';
  readonly actor: Actor;
  readonly verb: Verb;
  readonly object: Activity | Agent | Group | StatementRef; // no nested SubStatement
  readonly result?: Result;
  readonly context?: Context;
  readonly timestamp?: string;
  readonly attachments?: readonly Attachment[];
}

/** The union of all valid Statement.object types. */
export type StatementObject = Activity | Agent | Group | StatementRef | SubStatement;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface Score {
  readonly scaled?: number;
  readonly raw?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface Result {
  readonly score?: Score;
  readonly success?: boolean;
  readonly completion?: boolean;
  readonly response?: string;
  readonly duration?: string; // ISO 8601 duration
  readonly extensions?: Extensions;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ContextActivities {
  readonly parent?: readonly Activity[];
  readonly grouping?: readonly Activity[];
  readonly category?: readonly Activity[];
  readonly other?: readonly Activity[];
}

export interface Context {
  readonly registration?: string; // UUID
  readonly instructor?: Actor;
  readonly team?: Group;
  readonly contextActivities?: ContextActivities;
  readonly revision?: string;
  readonly platform?: string;
  readonly language?: string; // RFC 5646
  readonly statement?: StatementRef;
  readonly extensions?: Extensions;
}

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

export interface Attachment {
  readonly usageType: string;
  readonly display: LanguageMap;
  readonly description?: LanguageMap;
  readonly contentType: string;
  readonly length: number;
  readonly sha2: string;
  readonly fileUrl?: string;
}

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

export interface Statement {
  readonly id?: string;
  readonly actor: Actor;
  readonly verb: Verb;
  readonly object: StatementObject;
  readonly result?: Result;
  readonly context?: Context;
  readonly timestamp?: string;
  readonly stored?: string;
  readonly authority?: Actor;
  readonly version?: string;
  readonly attachments?: readonly Attachment[];
}

// ---------------------------------------------------------------------------
// Wire types — request/response shapes
// ---------------------------------------------------------------------------

/** Response from a filtered GET /statements query. */
export interface StatementResult {
  readonly statements: readonly Statement[];
  readonly more?: string;
}

/** Response from GET /agents — merged agent identity. */
export interface Person {
  readonly objectType: 'Person';
  readonly name?: readonly string[];
  readonly mbox?: readonly string[];
  readonly mbox_sha1sum?: readonly string[];
  readonly openid?: readonly string[];
  readonly account?: readonly Account[];
}

/** Response from GET /about. */
export interface AboutResource {
  readonly version: readonly string[];
  readonly extensions?: Extensions;
}

// ---------------------------------------------------------------------------
// Query parameter types
// ---------------------------------------------------------------------------

export type StatementFormat = 'ids' | 'exact' | 'canonical';

export interface StatementQuery {
  readonly agent?: Agent;
  readonly verb?: string;
  readonly activity?: string;
  readonly registration?: string;
  readonly related_activities?: boolean;
  readonly related_agents?: boolean;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
  readonly format?: StatementFormat;
  readonly attachments?: boolean;
  readonly ascending?: boolean;
  readonly cursor?: string;
}

// ---------------------------------------------------------------------------
// Document storage
// ---------------------------------------------------------------------------

/** A stored document with its content, content type, and concurrency tag. */
export interface StoredDocument {
  readonly content: Buffer;
  readonly contentType: string;
  readonly etag: string;
  readonly updatedAt: Date;
}
