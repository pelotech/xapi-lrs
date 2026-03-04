// Barrel re-export — keeps `import * as Q from './pg-xapi.queries.js'` working.
export type { Queryable, PersonData } from './pg-xapi.shared.js';
export { agentToPersonData, mergePersonData, extractAllActivities } from './pg-xapi.shared.js';
export {
  encodeCursor, decodeCursor, ifiToJsonbContains, statementsMatch,
  storeStatements, getStatement, getVoidedStatement, getConsistentThrough, queryStatements,
} from './pg-xapi.statements.js';
export {
  getStateDocument, getStateIds, setStateDocument, mergeStateDocument, deleteStateDocument, deleteStateDocuments,
  getActivityProfileDocument, getActivityProfileIds, setActivityProfileDocument, mergeActivityProfileDocument, deleteActivityProfileDocument,
  getAgentProfileDocument, getAgentProfileIds, setAgentProfileDocument, mergeAgentProfileDocument, deleteAgentProfileDocument,
} from './pg-xapi.documents.js';
export type { AttachmentMetaRow } from './pg-xapi.resources.js';
export {
  storeAttachmentMeta, getAttachmentMetaBatch,
  getActivity, getActivitiesBatch, getAgent,
} from './pg-xapi.resources.js';
