import { Prisma } from '@prisma/client';
import { prisma } from '../../db';

export const CRITICAL_OPERATION_INDEX_NAMES = [
  'operations_user_id_entity_type_entity_id_server_seq_idx',
  'operations_user_id_server_seq_key',
  'operations_user_id_full_state_server_seq_idx',
] as const;

type OperationIndexHealthRow = {
  indexName: string;
  exists: boolean;
  isValid: boolean;
};

export class OperationIndexHealthService {
  async assertCriticalOperationIndexesValid(): Promise<void> {
    const requiredIndexValues = Prisma.join(
      CRITICAL_OPERATION_INDEX_NAMES.map((indexName) => Prisma.sql`(${indexName})`),
    );
    const rows: OperationIndexHealthRow[] = await prisma.$queryRaw<
      OperationIndexHealthRow[]
    >`
      WITH required(index_name) AS (VALUES ${requiredIndexValues}),
      operation_indexes AS (
        SELECT
          index_class.relname AS index_name,
          pg_index.indisvalid AS is_valid
        FROM pg_index
        JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
        JOIN pg_class table_class ON table_class.oid = pg_index.indrelid
        JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
        WHERE table_class.relname = 'operations'
          -- SuperSync uses Prisma's default public schema; keep the self-check scoped there.
          AND table_namespace.nspname = current_schema()
      )
      SELECT
        required.index_name AS "indexName",
        operation_indexes.index_name IS NOT NULL AS "exists",
        COALESCE(operation_indexes.is_valid, false) AS "isValid"
      FROM required
      LEFT JOIN operation_indexes ON operation_indexes.index_name = required.index_name
      ORDER BY required.index_name
    `;

    const rowByName = new Map<string, OperationIndexHealthRow>(
      rows.map((row: OperationIndexHealthRow) => [row.indexName, row]),
    );
    const missingIndexes = CRITICAL_OPERATION_INDEX_NAMES.filter(
      (indexName) => !rowByName.get(indexName)?.exists,
    );
    const invalidIndexes = CRITICAL_OPERATION_INDEX_NAMES.filter((indexName) => {
      const row = rowByName.get(indexName);
      return row?.exists === true && row.isValid !== true;
    });

    if (missingIndexes.length === 0 && invalidIndexes.length === 0) {
      return;
    }

    const details = [
      missingIndexes.length > 0 ? `missing: ${missingIndexes.join(', ')}` : undefined,
      invalidIndexes.length > 0 ? `invalid: ${invalidIndexes.join(', ')}` : undefined,
    ]
      .filter(Boolean)
      .join('; ');

    throw new Error(
      `SuperSync critical operations indexes are not ready (${details}). ` +
        'Run or repair database migrations before starting the server.',
    );
  }
}
