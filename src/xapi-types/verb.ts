/**
 * CMI5 Verb definitions and IRI constants.
 *
 * These are shared between the LRS (verb blocklist enforcement) and the API
 * (registration machine event mapping).
 */

import type { XAPIVerb } from './statement.ts';

export const CMI5_VERBS = {
  // LMS-issued verbs
  LAUNCHED: { id: 'http://adlnet.gov/expapi/verbs/launched', display: { 'en-US': 'launched' } },
  ABANDONED: { id: 'https://w3id.org/xapi/adl/verbs/abandoned', display: { 'en-US': 'abandoned' } },
  WAIVED: { id: 'https://w3id.org/xapi/adl/verbs/waived', display: { 'en-US': 'waived' } },
  SATISFIED: { id: 'https://w3id.org/xapi/adl/verbs/satisfied', display: { 'en-US': 'satisfied' } },

  // AU-issued verbs
  INITIALIZED: {
    id: 'http://adlnet.gov/expapi/verbs/initialized',
    display: { 'en-US': 'initialized' },
  },
  TERMINATED: {
    id: 'http://adlnet.gov/expapi/verbs/terminated',
    display: { 'en-US': 'terminated' },
  },
  PASSED: { id: 'http://adlnet.gov/expapi/verbs/passed', display: { 'en-US': 'passed' } },
  FAILED: { id: 'http://adlnet.gov/expapi/verbs/failed', display: { 'en-US': 'failed' } },
  COMPLETED: { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
} as const satisfies Record<string, XAPIVerb>;

export type CMI5VerbId = (typeof CMI5_VERBS)[keyof typeof CMI5_VERBS]['id'];

/** Verb IRIs that only the LMS may issue (AUs must not send these). */
export const LMS_ONLY_VERB_IDS: ReadonlySet<string> = new Set([
  CMI5_VERBS.LAUNCHED.id,
  CMI5_VERBS.ABANDONED.id,
  CMI5_VERBS.WAIVED.id,
  CMI5_VERBS.SATISFIED.id,
]);

/** Verb IRIs that govern session lifecycle (launched/initialized/terminated/abandoned). */
export const SESSION_LIFECYCLE_VERB_IDS: ReadonlySet<string> = new Set([
  CMI5_VERBS.LAUNCHED.id,
  CMI5_VERBS.INITIALIZED.id,
  CMI5_VERBS.TERMINATED.id,
  CMI5_VERBS.ABANDONED.id,
]);
