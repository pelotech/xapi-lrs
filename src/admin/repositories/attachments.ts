/**
 * Admin attachment queries.
 */

import type { QueryConfig } from 'pg';
import type { DbPool } from '../../db.ts';
import type { LrsMetrics } from '../../metrics.ts';
import { poolQuery } from '../../db.ts';

type Query = Omit<QueryConfig, 'values'>;

const LIST_ATTACHMENTS = {
  name: 'admin_list_attachments',
  text: 'SELECT attachment_sha, content_type, content_length FROM attachment WHERE statement_id = $1',
} as const satisfies Query;

const GET_ATTACHMENT = {
  name: 'admin_get_attachment',
  text: 'SELECT contents, content_type FROM attachment WHERE statement_id = $1 AND attachment_sha = $2',
} as const satisfies Query;

export interface AttachmentListRow {
  attachment_sha: string;
  content_type: string;
  content_length: number;
}

export async function listAttachments(
  pool: DbPool,
  metrics: LrsMetrics,
  statementId: string,
): Promise<AttachmentListRow[]> {
  const result = await poolQuery<AttachmentListRow>(pool, metrics, {
    ...LIST_ATTACHMENTS,
    values: [statementId],
  });
  return result.rows;
}

export async function getAttachment(
  pool: DbPool,
  metrics: LrsMetrics,
  statementId: string,
  sha: string,
): Promise<{ contents: Buffer; content_type: string } | null> {
  const result = await poolQuery<{ contents: Buffer; content_type: string }>(pool, metrics, {
    ...GET_ATTACHMENT,
    values: [statementId, sha],
  });
  return result.rows[0] ?? null;
}
