/**
 * Library exports for xapi-lrs.
 * Used by test utilities and the replay-tool.
 */

export { createApp } from "./app.ts";
export type { AppDeps } from "./app.ts";
export { createAdminApp } from "./admin/index.ts";
export type { AdminDeps } from "./admin/index.ts";
export { ensureAdminAccount } from "./admin/repositories/index.ts";
export { loadConfig } from "./config.ts";
export type { LrsConfig } from "./config.ts";
export { createPool, withClient, poolQuery, HttpError } from "./db.ts";
export { createLogger } from "./logger.ts";
export type { Logger } from "./logger.ts";
export { createMetrics, startTimer } from "./metrics.ts";
export type { LrsMetrics } from "./metrics.ts";
export { JwksCache, discoverJwksUri, verifyJwt } from "./auth/jwt.ts";
export type { JwtConfig, JwtResult } from "./auth/jwt.ts";
export { authMiddleware, authenticateBasicCredential } from "./middleware/authentication.ts";
export type { AuthDeps } from "./middleware/authentication.ts";
export type {
  AuthPayloadBasic,
  AuthPayloadJWT,
  AuthPayload,
  AuthInfo,
  XapiScope,
} from "./auth/types.ts";

// Helpers
export { computeEtag, checkConcurrencyHeaders } from "./helpers/etag.ts";
export type { ConcurrencyHeaders } from "./helpers/etag.ts";
export {
  canonicalAgentIfi,
  agentActorType,
  validateSince,
  validateRegistration,
} from "./helpers/agent.ts";
export {
  enrichStatement,
  formatStatement,
  buildAuthority,
  LRS_AUTHORITY_HOME_PAGE,
} from "./helpers/enrichment.ts";
export { squuid, squuidMin, squuidTimestamp } from "./helpers/squuid.ts";

// Deps
export type { LrsDeps } from "./deps.ts";
export type { HonoEnv } from "./hono-env.ts";

// Repositories
export {
  insertStatement,
  insertStatements,
  getStatementById,
  queryStatements,
  voidStatement,
  getConsistentThrough,
  getActivityDefinition,
} from "./repositories/statements.ts";
export type {
  XapiStatementRow,
  StatementQueryParams,
  InsertStatementResult,
} from "./repositories/statements.ts";
export {
  upsertStateDocument,
  getStateDocument,
  listStateIds,
  deleteStateDocument,
  deleteAllStateDocuments,
} from "./repositories/activity-state.ts";
export type { StateDocumentRow } from "./repositories/activity-state.ts";
export {
  upsertActivityProfile,
  getActivityProfile,
  listActivityProfileIds,
  deleteActivityProfile,
} from "./repositories/activity-profile.ts";
export type { ActivityProfileRow } from "./repositories/activity-profile.ts";
export {
  upsertAgentProfile,
  getAgentProfile,
  listAgentProfileIds,
  deleteAgentProfile,
} from "./repositories/agent-profile.ts";
export type { AgentProfileRow } from "./repositories/agent-profile.ts";
export { insertAttachment, getAttachmentsByStatement } from "./repositories/attachments.ts";
export type { AttachmentRow } from "./repositories/attachments.ts";

// SSE
export { PgListener } from "./sse/pg-listener.ts";
export type { NotificationHandler } from "./sse/pg-listener.ts";
export { createSseRoute } from "./sse/sse-producer.ts";
export type { SseProducerDeps } from "./sse/sse-producer.ts";

// xAPI utilities
export { validateStatement, hasCmi5Shape, allHaveCmi5Shape } from "./xapi/statement-validator.ts";
export type { ValidationError, ValidationResult } from "./xapi/statement-validator.ts";
export { statementsEquivalent, statementsMatch } from "./xapi/statement-compare.ts";
export { validateSignedStatements, _resetWarnedDisabled } from "./xapi/signature.ts";
export type { SignatureValidationOptions, SignatureMetricsContext } from "./xapi/signature.ts";
export { extractBoundary, parseMultipartMixed, buildMultipartResponse } from "./xapi/multipart.ts";
export type {
  MultipartAttachmentPart,
  MultipartParseResult,
  ResponseAttachmentPart,
} from "./xapi/multipart.ts";
