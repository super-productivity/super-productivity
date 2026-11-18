import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import {
  MAX_LISTED_LOCAL_CHANGES,
  SyncImportConflictChange,
  summarizePendingOps,
} from './sync-import-conflict-change-summary.util';

describe('summarizePendingOps', () => {
  let seq = 0;

  const listChanges = (
    entries: OperationLogEntry[],
  ): SyncImportConflictChange[] | undefined => summarizePendingOps(entries)?.changes;

  const entry = (overrides: Partial<Operation>): OperationLogEntry => ({
    seq: ++seq,
    appliedAt: 1,
    source: 'local',
    op: {
      id: `op-${seq}`,
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: {},
      clientId: 'client-A',
      vectorClock: { clientA: seq },
      timestamp: 1,
      schemaVersion: 1,
      ...overrides,
    },
  });

  beforeEach(() => {
    seq = 0;
  });

  it('should return undefined when there is nothing to list', () => {
    expect(listChanges([])).toBeUndefined();
  });

  it('should return undefined above the listing limit', () => {
    const entries = Array.from({ length: MAX_LISTED_LOCAL_CHANGES + 1 }, (_, i) =>
      entry({ entityId: `task-${i}` }),
    );

    expect(listChanges(entries)).toBeUndefined();
  });

  it('should list exactly at the limit', () => {
    const entries = Array.from({ length: MAX_LISTED_LOCAL_CHANGES }, (_, i) =>
      entry({ entityId: `task-${i}` }),
    );

    expect(listChanges(entries)?.length).toBe(MAX_LISTED_LOCAL_CHANGES);
  });

  it('should read the title of a created task', () => {
    const result = listChanges([
      entry({
        actionType: ActionType.TASK_SHARED_ADD,
        opType: OpType.Create,
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', title: 'Buy milk' } },
        },
      }),
    ]);

    expect(result).toEqual([
      { entityType: 'TASK', entityId: 'task-1', kind: 'CREATED', label: 'Buy milk' },
    ]);
  });

  it('should merge several edits of one task into one row with the newest title', () => {
    const result = listChanges([
      entry({
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', changes: { title: 'Old title' } } },
        },
      }),
      entry({
        payload: {
          entityChanges: [],
          actionPayload: {
            task: { id: 'task-1', changes: { title: 'New title', isDone: true } },
          },
        },
      }),
    ]);

    expect(result).toEqual([
      {
        entityType: 'TASK',
        entityId: 'task-1',
        kind: 'UPDATED',
        label: 'New title',
      },
    ]);
  });

  it('should still treat a repeat-config update as automatic when only id/modified ride along', () => {
    const summary = summarizePendingOps([
      entry({
        entityType: 'TASK_REPEAT_CFG',
        entityId: 'cfg-1',
        payload: {
          entityChanges: [],
          actionPayload: {
            taskRepeatCfg: { id: 'cfg-1', changes: { modified: 5, lastTaskCreation: 1 } },
          },
        },
      }),
    ]);

    expect(summary).toEqual({ changes: [], automaticOpCount: 1 });
  });

  it('should report a delete over a create or update of the same entity', () => {
    const result = listChanges([
      entry({ opType: OpType.Update }),
      entry({ opType: OpType.Delete }),
    ]);

    expect(result?.[0].kind).toBe('DELETED');
  });

  it('should expand a bulk op into a row per entity without guessing labels', () => {
    const result = listChanges([
      entry({
        opType: OpType.Delete,
        entityId: undefined,
        entityIds: ['task-1', 'task-2'],
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', title: 'Only the first' } },
        },
      }),
    ]);

    expect(result).toEqual([
      { entityType: 'TASK', entityId: 'task-1', kind: 'DELETED' },
      { entityType: 'TASK', entityId: 'task-2', kind: 'DELETED' },
    ]);
  });

  it('should return undefined when one bulk op touches more entities than the limit', () => {
    const entityIds = Array.from(
      { length: MAX_LISTED_LOCAL_CHANGES + 1 },
      (_, i) => `task-${i}`,
    );

    expect(
      listChanges([entry({ opType: OpType.Update, entityId: undefined, entityIds })]),
    ).toBeUndefined();
  });

  it('should list a bulk op that touches exactly the limit', () => {
    const entityIds = Array.from(
      { length: MAX_LISTED_LOCAL_CHANGES },
      (_, i) => `task-${i}`,
    );

    expect(
      listChanges([entry({ opType: OpType.Update, entityId: undefined, entityIds })])
        ?.length,
    ).toBe(MAX_LISTED_LOCAL_CHANGES);
  });

  it('should count touched entities, not ops, against the limit', () => {
    const entries = [
      ...Array.from({ length: 15 }, (_, i) => entry({ entityId: `task-${i}` })),
      entry({
        entityId: undefined,
        entityIds: Array.from({ length: 6 }, (_, i) => `bulk-${i}`),
      }),
    ];

    expect(listChanges(entries)).toBeUndefined();
  });

  it('should read the title of a single archived task from the array payload', () => {
    const result = listChanges([
      entry({
        opType: OpType.Update,
        entityId: 'task-1',
        payload: {
          entityChanges: [],
          actionPayload: {
            tasks: [
              { id: 'other', title: 'Not this one' },
              { id: 'task-1', title: 'Archived task' },
            ],
          },
        },
      }),
    ]);

    expect(result).toEqual([
      { entityType: 'TASK', entityId: 'task-1', kind: 'UPDATED', label: 'Archived task' },
    ]);
  });

  it('should not take a title from an array element of a different entity', () => {
    const result = listChanges([
      entry({
        entityId: 'task-1',
        payload: {
          entityChanges: [],
          actionPayload: { tasks: [{ id: 'other', title: 'Not this one' }] },
        },
      }),
    ]);

    expect(result?.[0].label).toBeUndefined();
  });

  it('should report a pending full-state op as an import', () => {
    const result = listChanges([
      entry({
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.BackupImport,
        entityType: 'ALL',
        entityId: undefined,
      }),
    ]);

    expect(result).toEqual([{ entityType: 'ALL', kind: 'IMPORTED' }]);
  });

  it('should count repeat-config bookkeeping updates instead of listing them', () => {
    const repeatCfgUpdate = (changes: Record<string, unknown>): OperationLogEntry =>
      entry({
        entityType: 'TASK_REPEAT_CFG',
        entityId: 'cfg-1',
        payload: {
          entityChanges: [],
          actionPayload: { taskRepeatCfg: { id: 'cfg-1', changes } },
        },
      });

    const summary = summarizePendingOps([
      repeatCfgUpdate({ lastTaskCreation: 1, lastTaskCreationDay: '2026-10-26' }),
      repeatCfgUpdate({ lastTaskCreationDay: '2026-10-27' }),
      entry({ entityId: 'task-1' }),
    ]);

    expect(summary?.automaticOpCount).toBe(2);
    expect(summary?.changes.map((c) => c.entityType)).toEqual(['TASK']);
  });

  it('should still list a repeat-config edit that touches a user-facing field', () => {
    const summary = summarizePendingOps([
      entry({
        entityType: 'TASK_REPEAT_CFG',
        entityId: 'cfg-1',
        payload: {
          entityChanges: [],
          actionPayload: {
            taskRepeatCfg: {
              id: 'cfg-1',
              changes: { title: 'Gym', lastTaskCreation: 1 },
            },
          },
        },
      }),
    ]);

    expect(summary?.automaticOpCount).toBe(0);
    expect(summary?.changes[0]).toEqual(
      jasmine.objectContaining({ entityType: 'TASK_REPEAT_CFG', label: 'Gym' }),
    );
  });

  it('should keep different entity types with the same id apart', () => {
    const result = listChanges([
      entry({ entityType: 'TASK', entityId: 'x' }),
      entry({ entityType: 'NOTE', entityId: 'x' }),
    ]);

    expect(result?.map((c) => c.entityType)).toEqual(['TASK', 'NOTE']);
  });

  it('should read a name for entities that have no title', () => {
    const result = listChanges([
      entry({
        entityType: 'TAG',
        entityId: 'tag-1',
        opType: OpType.Create,
        payload: {
          entityChanges: [],
          actionPayload: { tag: { id: 'tag-1', name: 'Errands' } },
        },
      }),
    ]);

    expect(result?.[0].label).toBe('Errands');
  });

  it('should tolerate payloads that are not objects', () => {
    const result = listChanges([entry({ payload: null as unknown })]);

    expect(result).toEqual([{ entityType: 'TASK', entityId: 'task-1', kind: 'UPDATED' }]);
  });
});
