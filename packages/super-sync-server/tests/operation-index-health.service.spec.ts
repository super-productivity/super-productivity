import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CRITICAL_OPERATION_INDEX_NAMES,
  OperationIndexHealthService,
} from '../src/sync/services/operation-index-health.service';

vi.mock('../src/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from '../src/db';

const validRows = CRITICAL_OPERATION_INDEX_NAMES.map((indexName) => ({
  indexName,
  exists: true,
  isValid: true,
}));

describe('OperationIndexHealthService', () => {
  let service: OperationIndexHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OperationIndexHealthService();
  });

  it('resolves when all critical operations indexes exist and are valid', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(validRows);

    await expect(service.assertCriticalOperationIndexesValid()).resolves.toBeUndefined();
  });

  it('throws with missing and invalid index details', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        indexName: 'operations_user_id_entity_type_entity_id_server_seq_idx',
        exists: false,
        isValid: false,
      },
      {
        indexName: 'operations_user_id_server_seq_key',
        exists: true,
        isValid: false,
      },
      {
        indexName: 'operations_user_id_full_state_server_seq_idx',
        exists: true,
        isValid: true,
      },
    ]);

    await expect(service.assertCriticalOperationIndexesValid()).rejects.toThrow(
      /missing: operations_user_id_entity_type_entity_id_server_seq_idx/,
    );
    await expect(service.assertCriticalOperationIndexesValid()).rejects.toThrow(
      /invalid: operations_user_id_server_seq_key/,
    );
  });

  it('treats absent result rows as missing critical indexes', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([validRows[0]]);

    await expect(service.assertCriticalOperationIndexesValid()).rejects.toThrow(
      /operations_user_id_server_seq_key/,
    );
  });

  it('checks pg_index validity for the named operations-table indexes', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(validRows);

    await service.assertCriticalOperationIndexesValid();

    const [queryParts] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [
      TemplateStringsArray,
    ];
    const query = Array.from(queryParts).join('');

    expect(query).toContain('pg_index.indisvalid');
    expect(query).toContain("table_class.relname = 'operations'");
    for (const indexName of CRITICAL_OPERATION_INDEX_NAMES) {
      expect(query).toContain(indexName);
    }
  });
});
