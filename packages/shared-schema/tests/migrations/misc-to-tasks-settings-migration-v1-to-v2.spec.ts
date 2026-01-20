import { describe, it, expect } from 'vitest';
import { MIGRATIONS } from '../../src/migrations';
import { OperationLike } from '../../src/migration.types';

describe('Migrate MiscConfig to TasksConfig', () => {
  const migration = MIGRATIONS.find((m) => m.fromVersion === 1 && m.toVersion === 2);

  if (!migration) {
    throw new Error('Migration for version 1 to 2 not found');
  }

  describe('migrateState', () => {
    it('should migrate settings from misc to tasks', () => {
      const initialState = {
        globalConfig: {
          misc: {
            isConfirmBeforeTaskDelete: true,
            isAutoAddWorkedOnToToday: true,
            isAutMarkParentAsDone: false,
            isTrayShowCurrentTask: true,
            isTurnOffMarkdown: false,
            defaultProjectId: 'project_1',
            taskNotesTpl: 'Template',
          },
          tasks: {},
        },
      };

      const migratedState = migration.migrateState(initialState) as {
        globalConfig: {
          misc: Record<string, unknown>;
          tasks: Record<string, unknown>;
        };
      };

      expect(migratedState.globalConfig.tasks).toEqual({
        isConfirmBeforeDelete: true,
        isAutoAddWorkedOnToToday: true,
        isAutoMarkParentAsDone: false,
        isTrayShowCurrent: true,
        isMarkdownFormattingInNotesEnabled: true,
        defaultProjectId: 'project_1',
        notesTemplate: 'Template',
      });

      expect(migratedState.globalConfig.misc).toEqual({});
    });

    it('should not modify state if misc is empty', () => {
      const initialState = {
        globalConfig: {
          misc: {},
          tasks: {},
        },
      };

      const migratedState = migration.migrateState(initialState) as {
        globalConfig: {
          misc: Record<string, unknown>;
          tasks: Record<string, unknown>;
        };
      };

      expect(migratedState).toEqual(initialState);
    });

    it('should not modify state if tasks already migrated', () => {
      const initialState = {
        globalConfig: {
          misc: {
            isConfirmBeforeTaskDelete: true,
          },
          tasks: {
            isConfirmBeforeDelete: true,
          },
        },
      };

      const migratedState = migration.migrateState(initialState) as {
        globalConfig: {
          misc: Record<string, unknown>;
          tasks: Record<string, unknown>;
        };
      };

      expect(migratedState).toEqual(initialState);
    });
  });

  describe('migrateOperation', () => {
    it('should split misc operation into misc and tasks operations', () => {
      const op: OperationLike = {
        id: 'op_1',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        payload: {
          isConfirmBeforeTaskDelete: true,
          isTurnOffMarkdown: true,
          isMinimizeToTray: false,
        },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(op);

      expect(Array.isArray(result)).toBe(true);
      const resultArray = result as OperationLike[];
      expect(resultArray.length).toBe(2);

      // First operation should be misc with non-migrated settings
      const miscOp = resultArray.find((r) => r.entityId === 'misc');
      expect(miscOp).toBeDefined();
      expect(miscOp!.payload).toEqual({
        isMinimizeToTray: false,
      });

      // Second operation should be tasks with migrated settings
      const tasksOp = resultArray.find((r) => r.entityId === 'tasks');
      expect(tasksOp).toBeDefined();
      expect(tasksOp!.id).toBe('op_1_tasks_migrated');
      expect(tasksOp!.payload).toEqual({
        isConfirmBeforeDelete: true,
        isMarkdownFormattingInNotesEnabled: false, // Inverted from isTurnOffMarkdown: true
      });
    });

    it('should return only tasks operation when misc payload contains only migrated settings', () => {
      const op: OperationLike = {
        id: 'op_2',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        payload: {
          isAutoAddWorkedOnToToday: true,
          defaultProjectId: 'project_123',
        },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(op);

      // Should return single tasks operation
      expect(Array.isArray(result)).toBe(false);
      const singleOp = result as OperationLike;
      expect(singleOp.entityId).toBe('tasks');
      expect(singleOp.payload).toEqual({
        isAutoAddWorkedOnToToday: true,
        defaultProjectId: 'project_123',
      });
    });

    it('should not modify non-GLOBAL_CONFIG operations', () => {
      const op: OperationLike = {
        id: 'op_3',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task_1',
        payload: { title: 'Test task' },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(op);

      expect(result).toEqual(op);
    });

    it('should not modify GLOBAL_CONFIG operations with non-misc entityId', () => {
      const op: OperationLike = {
        id: 'op_4',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'keyboard',
        payload: { someKey: 'value' },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(op);

      expect(result).toEqual(op);
    });

    it('should not modify misc operations without migrated settings', () => {
      const op: OperationLike = {
        id: 'op_5',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        payload: {
          isMinimizeToTray: true,
          isConfirmBeforeExit: false,
        },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(op);

      expect(result).toEqual(op);
    });

    it('should correctly invert isTurnOffMarkdown to isMarkdownFormattingInNotesEnabled', () => {
      const opWithMarkdownOff: OperationLike = {
        id: 'op_6',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        payload: { isTurnOffMarkdown: true },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(opWithMarkdownOff) as OperationLike;
      expect(result.entityId).toBe('tasks');
      expect(
        (result.payload as Record<string, unknown>)['isMarkdownFormattingInNotesEnabled'],
      ).toBe(false);

      const opWithMarkdownOn: OperationLike = {
        id: 'op_7',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        payload: { isTurnOffMarkdown: false },
        schemaVersion: 1,
      };

      const result2 = migration.migrateOperation!(opWithMarkdownOn) as OperationLike;
      expect(result2.entityId).toBe('tasks');
      expect(
        (result2.payload as Record<string, unknown>)[
          'isMarkdownFormattingInNotesEnabled'
        ],
      ).toBe(true);
    });

    it('should rename isAutMarkParentAsDone to isAutoMarkParentAsDone', () => {
      const op: OperationLike = {
        id: 'op_8',
        opType: 'UPD',
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        payload: { isAutMarkParentAsDone: true },
        schemaVersion: 1,
      };

      const result = migration.migrateOperation!(op) as OperationLike;
      expect(result.entityId).toBe('tasks');
      expect((result.payload as Record<string, unknown>)['isAutoMarkParentAsDone']).toBe(
        true,
      );
      expect(
        (result.payload as Record<string, unknown>)['isAutMarkParentAsDone'],
      ).toBeUndefined();
    });

    describe('MultiEntityPayload format', () => {
      it('should handle MultiEntityPayload with sectionCfg containing migrated settings', () => {
        const op: OperationLike = {
          id: 'op_multi_1',
          opType: 'UPD',
          entityType: 'GLOBAL_CONFIG',
          entityId: 'misc',
          payload: {
            actionPayload: {
              sectionKey: 'misc',
              sectionCfg: {
                isConfirmBeforeTaskDelete: true,
                isTurnOffMarkdown: true,
                isMinimizeToTray: false,
              },
            },
            entityChanges: [],
          },
          schemaVersion: 1,
        };

        const result = migration.migrateOperation!(op);

        expect(Array.isArray(result)).toBe(true);
        const resultArray = result as OperationLike[];
        expect(resultArray.length).toBe(2);

        // Misc operation
        const miscOp = resultArray.find((r) => r.entityId === 'misc');
        expect(miscOp).toBeDefined();
        const miscPayload = miscOp!.payload as {
          actionPayload: { sectionKey: string; sectionCfg: Record<string, unknown> };
        };
        expect(miscPayload.actionPayload.sectionKey).toBe('misc');
        expect(miscPayload.actionPayload.sectionCfg).toEqual({
          isMinimizeToTray: false,
        });

        // Tasks operation
        const tasksOp = resultArray.find((r) => r.entityId === 'tasks');
        expect(tasksOp).toBeDefined();
        const tasksPayload = tasksOp!.payload as {
          actionPayload: { sectionKey: string; sectionCfg: Record<string, unknown> };
        };
        expect(tasksPayload.actionPayload.sectionKey).toBe('tasks');
        expect(tasksPayload.actionPayload.sectionCfg).toEqual({
          isConfirmBeforeDelete: true,
          isMarkdownFormattingInNotesEnabled: false,
        });
      });

      it('should handle MultiEntityPayload with only migrated settings', () => {
        const op: OperationLike = {
          id: 'op_multi_2',
          opType: 'UPD',
          entityType: 'GLOBAL_CONFIG',
          entityId: 'misc',
          payload: {
            actionPayload: {
              sectionKey: 'misc',
              sectionCfg: {
                defaultProjectId: 'project_abc',
                taskNotesTpl: 'My template',
              },
            },
            entityChanges: [],
          },
          schemaVersion: 1,
        };

        const result = migration.migrateOperation!(op);

        // Should return single tasks operation
        expect(Array.isArray(result)).toBe(false);
        const singleOp = result as OperationLike;
        expect(singleOp.entityId).toBe('tasks');
        const payload = singleOp.payload as {
          actionPayload: { sectionKey: string; sectionCfg: Record<string, unknown> };
        };
        expect(payload.actionPayload.sectionKey).toBe('tasks');
        expect(payload.actionPayload.sectionCfg).toEqual({
          defaultProjectId: 'project_abc',
          notesTemplate: 'My template',
        });
      });

      it('should not modify MultiEntityPayload without migrated settings', () => {
        const op: OperationLike = {
          id: 'op_multi_3',
          opType: 'UPD',
          entityType: 'GLOBAL_CONFIG',
          entityId: 'misc',
          payload: {
            actionPayload: {
              sectionKey: 'misc',
              sectionCfg: {
                isMinimizeToTray: true,
                isConfirmBeforeExit: false,
              },
            },
            entityChanges: [],
          },
          schemaVersion: 1,
        };

        const result = migration.migrateOperation!(op);

        expect(result).toEqual(op);
      });
    });
  });
});
