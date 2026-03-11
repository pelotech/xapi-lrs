/**
 * xAPI Attachment Repository — lrsql attachment table.
 *
 * Stores raw attachment binaries (bytea) in the DB per statement.
 */

import type { PoolClient, QueryConfig } from 'pg';

type Query = Omit<QueryConfig, 'values'>;

const INSERT_ATTACHMENT = {
  name: 'insert_attachment',
  text: `INSERT INTO attachment (id, statement_id, attachment_sha, content_type, content_length, contents)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
         ON CONFLICT (statement_id, attachment_sha) DO NOTHING`,
} as const satisfies Query;

const SELECT_ATTACHMENTS_BY_STATEMENT = {
  name: 'select_attachments_by_statement',
  text: `SELECT attachment_sha, content_type, contents FROM attachment
         WHERE statement_id = $1`,
} as const satisfies Query;

// ============================================================================
// Types
// ============================================================================

export interface AttachmentRow {
  attachment_sha: string;
  content_type: string;
  contents: Buffer;
}

// ============================================================================
// Functions
// ============================================================================

export async function insertAttachment(
  client: PoolClient,
  params: {
    statementId: string;
    sha2: string;
    contentType: string;
    data: Buffer;
  },
): Promise<void> {
  await client.query({
    ...INSERT_ATTACHMENT,
    values: [params.statementId, params.sha2, params.contentType, params.data.length, params.data],
  });
}

export async function getAttachmentsByStatement(
  client: PoolClient,
  statementId: string,
): Promise<AttachmentRow[]> {
  const result = await client.query({
    ...SELECT_ATTACHMENTS_BY_STATEMENT,
    values: [statementId],
  });
  return result.rows as AttachmentRow[];
}
