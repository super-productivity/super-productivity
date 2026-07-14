import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  PROJECT_DELETE_WINS_SCHEMA_VERSION,
} from '../../src/schema-version';
import { migrateOperation, migrateState } from '../../src/migrate';
import { ProjectDeleteWinsBarrierMigration_v3v4 } from '../../src/migrations/project-delete-wins-barrier-v3-to-v4';
import type { OperationLike } from '../../src/migration.types';

describe('project delete-wins compatibility barrier v3 -> v4', () => {
  it('makes marked project deletions visible as a new schema generation', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
    expect(PROJECT_DELETE_WINS_SCHEMA_VERSION).toBe(4);
    expect(ProjectDeleteWinsBarrierMigration_v3v4.fromVersion).toBe(3);
    expect(ProjectDeleteWinsBarrierMigration_v3v4.toVersion).toBe(4);
  });

  it('leaves v3 state data unchanged', () => {
    const state = { project: { ids: ['project-1'] } };

    const result = migrateState(state, 3, 4);

    expect(result.success).toBe(true);
    expect(result.data).toBe(state);
  });

  it('preserves historical project-delete semantics while stamping schema v4', () => {
    const operation: OperationLike = {
      id: 'legacy-project-delete',
      opType: 'DEL',
      entityType: 'PROJECT',
      entityId: 'project-1',
      payload: {
        actionPayload: {
          projectId: 'project-1',
          noteIds: [],
          allTaskIds: [],
        },
        entityChanges: [],
      },
      schemaVersion: 3,
    };

    const result = migrateOperation(operation, 4);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...operation, schemaVersion: 4 });
  });
});
