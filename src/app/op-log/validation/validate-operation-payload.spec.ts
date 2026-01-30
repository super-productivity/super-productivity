import { validateOperationPayload } from './validate-operation-payload';
import { Operation, OpType, EntityType, ActionType } from '../core/operation.types';

describe('validateOperationPayload', () => {
  const createTestOperation = (overrides: Partial<Operation> = {}): Operation => ({
    id: 'opId123',
    // Cast: Using test placeholder action type
    actionType: '[Task] Update' as ActionType as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: 'task1',
    payload: { task: { id: 'task1', title: 'Test' } },
    clientId: 'testClient',
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  describe('basic structural validation', () => {
    it('should reject null payload', () => {
      const op = createTestOperation({
        payload: null as unknown as Record<string, unknown>,
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('null');
    });

    it('should reject undefined payload', () => {
      const op = createTestOperation({
        payload: undefined as unknown as Record<string, unknown>,
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('null');
    });

    it('should reject non-object payload', () => {
      const op = createTestOperation({
        payload: 'string' as unknown as Record<string, unknown>,
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('object');
    });

    it('should reject array payload', () => {
      const op = createTestOperation({
        payload: [{ id: 'task1' }, { id: 'task2' }] as unknown as Record<string, unknown>,
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('array');
    });
  });

  describe('CREATE operation', () => {
    it('should validate CREATE with valid entity', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'TASK' as EntityType,
        payload: { task: { id: 'newTask', title: 'New Task' } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should reject CREATE with entity missing id', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'TASK' as EntityType,
        payload: { task: { title: 'No ID Task' } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });

    it('should warn for CREATE with missing entity', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'TASK' as EntityType,
        payload: { someOtherKey: 'value' },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it('should validate CREATE for PROJECT entity', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'PROJECT' as EntityType,
        payload: { project: { id: 'proj1', title: 'Project' } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate CREATE for NOTE entity', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'NOTE' as EntityType,
        payload: { note: { id: 'note1', content: 'Content' } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });
  });

  describe('UPDATE operation', () => {
    it('should validate UPDATE with nested entity shape', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: { task: { id: 'task1', changes: { title: 'Updated' } } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate UPDATE with direct id shape', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: { id: 'task1', changes: { title: 'Updated' } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate UPDATE with batch shape (tasks array)', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: { tasks: [{ id: 'task1' }, { id: 'task2' }] },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate UPDATE with full entity in nested key', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: { task: { id: 'task1', title: 'Full Task' } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should allow unusual UPDATE structure with warning', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: { unusualKey: 'value' },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it('should validate TASK UPDATE with syncTimeSpent shape (taskId, date, duration)', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: 'task-123',
        payload: {
          taskId: 'task-123',
          date: '2024-01-15',
          duration: 3600000,
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it('should validate TASK UPDATE with syncTimeSpent shape with zero duration', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: 'task-456',
        payload: {
          taskId: 'task-456',
          date: '2024-12-25',
          duration: 0,
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it('should validate TIME_TRACKING UPDATE with syncTimeTracking shape', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TIME_TRACKING' as EntityType,
        entityId: 'TAG:tag1:2024-01-01',
        payload: {
          contextType: 'TAG',
          contextId: 'tag1',
          date: '2024-01-01',
          data: { timeSpentOnDay: 3600000 },
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it('should validate TIME_TRACKING UPDATE with updateWorkContextData shape', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TIME_TRACKING' as EntityType,
        entityId: 'PROJECT:proj1:2024-01-01',
        payload: {
          ctx: { id: 'proj1', type: 'PROJECT' },
          date: '2024-01-01',
          updates: { timeSpentOnDay: 7200000 },
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it('should allow TIME_TRACKING UPDATE with unusual shape but with warning', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TIME_TRACKING' as EntityType,
        payload: { unknownShape: 'value' },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });
  });

  describe('DELETE operation', () => {
    it('should validate DELETE with entityId on operation', () => {
      const op = createTestOperation({
        opType: OpType.Delete,
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        payload: {},
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate DELETE with entityIds array', () => {
      const op = createTestOperation({
        opType: OpType.Delete,
        entityType: 'TASK' as EntityType,
        entityId: undefined,
        entityIds: ['task1', 'task2'],
        payload: {},
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should reject DELETE with non-string entityIds', () => {
      const op = createTestOperation({
        opType: OpType.Delete,
        entityType: 'TASK' as EntityType,
        entityId: undefined,
        entityIds: ['task1', 123 as unknown as string],
        payload: {},
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('strings');
    });

    it('should validate DELETE with taskIds in payload', () => {
      const op = createTestOperation({
        opType: OpType.Delete,
        entityType: 'TASK' as EntityType,
        entityId: undefined,
        payload: { taskIds: ['task1', 'task2'] },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should allow DELETE with missing ids but with warning', () => {
      const op = createTestOperation({
        opType: OpType.Delete,
        entityType: 'TASK' as EntityType,
        entityId: undefined,
        entityIds: undefined,
        payload: {},
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });
  });

  describe('MOVE operation', () => {
    it('should validate MOVE with entityIds on operation', () => {
      const op = createTestOperation({
        opType: OpType.Move,
        entityType: 'TASK' as EntityType,
        entityIds: ['task1', 'task2', 'task3'],
        payload: {},
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate MOVE with ids in payload', () => {
      const op = createTestOperation({
        opType: OpType.Move,
        entityType: 'TASK' as EntityType,
        payload: { ids: ['task1', 'task2'] },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate MOVE with taskIds in payload', () => {
      const op = createTestOperation({
        opType: OpType.Move,
        entityType: 'TASK' as EntityType,
        payload: { taskIds: ['task1', 'task2'] },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should allow MOVE with missing ids but with warning', () => {
      const op = createTestOperation({
        opType: OpType.Move,
        entityType: 'TASK' as EntityType,
        payload: { noIdsHere: true },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
    });
  });

  describe('BATCH operation', () => {
    it('should validate BATCH with non-empty payload', () => {
      const op = createTestOperation({
        opType: OpType.Batch,
        payload: { tasks: [{ id: 'task1' }], updates: [] },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should reject BATCH with empty payload', () => {
      const op = createTestOperation({
        opType: OpType.Batch,
        payload: {},
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });
  });

  describe('SYNC_IMPORT/BACKUP_IMPORT operations', () => {
    it('should validate SYNC_IMPORT with appDataComplete', () => {
      const op = createTestOperation({
        opType: OpType.SyncImport,
        entityType: 'GLOBAL_CONFIG' as EntityType,
        payload: {
          appDataComplete: {
            task: { ids: [], entities: {} },
            project: { ids: [], entities: {} },
          },
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate BACKUP_IMPORT with direct data structure', () => {
      const op = createTestOperation({
        opType: OpType.BackupImport,
        entityType: 'GLOBAL_CONFIG' as EntityType,
        payload: {
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          globalConfig: {},
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should reject SYNC_IMPORT without expected keys', () => {
      const op = createTestOperation({
        opType: OpType.SyncImport,
        entityType: 'GLOBAL_CONFIG' as EntityType,
        payload: { randomData: 'value' },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
    });
  });

  describe('REPAIR operation', () => {
    it('should always validate REPAIR operations', () => {
      const op = createTestOperation({
        opType: OpType.Repair,
        payload: { anyPayload: 'isAllowed' },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });
  });

  describe('unknown operation type', () => {
    it('should allow unknown opType through', () => {
      const op = createTestOperation({
        opType: 'UNKNOWN_TYPE' as OpType,
        payload: { someData: true },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });
  });

  describe('multi-entity payload validation', () => {
    it('should validate valid MultiEntityPayload', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        payload: {
          actionPayload: { task: { id: 'task-1', changes: { title: 'Updated' } } },
          entityChanges: [
            {
              entityType: 'TASK',
              entityId: 'task-1',
              opType: OpType.Update,
              changes: { title: 'Updated' },
            },
            {
              entityType: 'TAG',
              entityId: 'tag-1',
              opType: OpType.Update,
              changes: { taskIds: ['task-1', 'task-2'] },
            },
          ],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate MultiEntityPayload with empty entityChanges', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        payload: {
          actionPayload: { task: { id: 'task-1', changes: { title: 'Test' } } },
          entityChanges: [],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it('should reject MultiEntityPayload with null actionPayload', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        payload: {
          actionPayload: null,
          entityChanges: [],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('actionPayload must be a non-null object');
    });

    it('should reject entityChange with missing entityType', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: {
          actionPayload: { task: { id: 'task-1', changes: {} } },
          entityChanges: [{ entityId: 'task-1', opType: OpType.Update, changes: {} }],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing or invalid entityType');
    });

    it('should reject entityChange with missing entityId', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: {
          actionPayload: { task: { id: 'task-1', changes: {} } },
          entityChanges: [{ entityType: 'TASK', opType: OpType.Update, changes: {} }],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing or invalid entityId');
    });

    it('should reject entityChange with missing opType', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        payload: {
          actionPayload: { task: { id: 'task-1', changes: {} } },
          entityChanges: [{ entityType: 'TASK', entityId: 'task-1', changes: {} }],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing or invalid opType');
    });

    it('should validate CREATE entityChange with valid entity data', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'TASK' as EntityType,
        entityId: 'task-new',
        payload: {
          actionPayload: { task: { id: 'task-new', title: 'New Task' } },
          entityChanges: [
            {
              entityType: 'TASK',
              entityId: 'task-new',
              opType: OpType.Create,
              changes: { id: 'task-new', title: 'New Task' },
            },
            {
              entityType: 'PROJECT',
              entityId: 'project-1',
              opType: OpType.Update,
              changes: { taskIds: ['task-new'] },
            },
          ],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should reject CREATE entityChange with null changes', () => {
      const op = createTestOperation({
        opType: OpType.Create,
        entityType: 'TASK' as EntityType,
        payload: {
          actionPayload: { task: { id: 'task-1' } },
          entityChanges: [
            {
              entityType: 'TASK',
              entityId: 'task-1',
              opType: OpType.Create,
              changes: null,
            },
          ],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(false);
      expect(result.error).toContain('CREATE requires changes to be an object');
    });

    it('should validate DELETE entityChange with minimal tombstone', () => {
      const op = createTestOperation({
        opType: OpType.Delete,
        entityType: 'TASK' as EntityType,
        entityId: 'task-to-delete',
        payload: {
          actionPayload: { task: { id: 'task-to-delete' } },
          entityChanges: [
            {
              entityType: 'TASK',
              entityId: 'task-to-delete',
              opType: OpType.Delete,
              changes: { id: 'task-to-delete' },
            },
            {
              entityType: 'TAG',
              entityId: 'tag-1',
              opType: OpType.Update,
              changes: { taskIds: [] },
            },
          ],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should validate singleton entityChange with * as entityId', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'GLOBAL_CONFIG' as EntityType,
        entityId: '*',
        payload: {
          actionPayload: { sectionKey: 'misc', sectionConfig: { isDarkMode: true } },
          entityChanges: [
            {
              entityType: 'GLOBAL_CONFIG',
              entityId: '*',
              opType: OpType.Update,
              changes: { misc: { isDarkMode: true } },
            },
          ],
        },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });

    it('should still validate legacy payload format (backward compatibility)', () => {
      const op = createTestOperation({
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        payload: { task: { id: 'task-1', changes: { title: 'Legacy Format' } } },
      });
      const result = validateOperationPayload(op);
      expect(result.success).toBe(true);
    });
  });
});
