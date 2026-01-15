import { Operation, OpType, EntityType } from '../../../core/operation.types';
import { TestClient } from './test-client.helper';

/**
 * Factory for creating task operations with sensible defaults.
 *
 * @param client The TestClient creating the operation
 * @param taskId The task entity ID
 * @param opType The operation type (Create, Update, Delete)
 * @param payload The task data or changes
 * @returns A complete Operation
 */
export const createTaskOperation = (
  client: TestClient,
  taskId: string,
  opType: OpType,
  payload: Record<string, unknown>,
): Operation => {
  const actionTypeMap: Record<OpType, string> = {
    [OpType.Create]: '[Task] Add Task',
    [OpType.Update]: '[Task] Update Task',
    [OpType.Delete]: '[Task] Delete Task',
    [OpType.Move]: '[Task] Move',
    [OpType.Batch]: '[Task] Batch Update',
    [OpType.SyncImport]: '[Task] Sync Import',
    [OpType.BackupImport]: '[Task] Backup Import',
    [OpType.Repair]: '[Task] Repair',
  };

  return client.createOperation({
    actionType: actionTypeMap[opType] || '[Task] Update Task',
    opType,
    entityType: 'TASK',
    entityId: taskId,
    payload,
  });
};

/**
 * Factory for creating project operations.
 */
export const createProjectOperation = (
  client: TestClient,
  projectId: string,
  opType: OpType,
  payload: Record<string, unknown>,
): Operation => {
  const actionTypeMap: Record<OpType, string> = {
    [OpType.Create]: '[Project] Add Project',
    [OpType.Update]: '[Project] Update Project',
    [OpType.Delete]: '[Project] Delete Project',
    [OpType.Move]: '[Project] Move',
    [OpType.Batch]: '[Project] Batch Update',
    [OpType.SyncImport]: '[Project] Sync Import',
    [OpType.BackupImport]: '[Project] Backup Import',
    [OpType.Repair]: '[Project] Repair',
  };

  return client.createOperation({
    actionType: actionTypeMap[opType] || '[Project] Update Project',
    opType,
    entityType: 'PROJECT',
    entityId: projectId,
    payload,
  });
};

/**
 * Factory for creating tag operations.
 */
export const createTagOperation = (
  client: TestClient,
  tagId: string,
  opType: OpType,
  payload: Record<string, unknown>,
): Operation => {
  const actionTypeMap: Record<OpType, string> = {
    [OpType.Create]: '[Tag] Add Tag',
    [OpType.Update]: '[Tag] Update Tag',
    [OpType.Delete]: '[Tag] Delete Tag',
    [OpType.Move]: '[Tag] Move',
    [OpType.Batch]: '[Tag] Batch Update',
    [OpType.SyncImport]: '[Tag] Sync Import',
    [OpType.BackupImport]: '[Tag] Backup Import',
    [OpType.Repair]: '[Tag] Repair',
  };

  return client.createOperation({
    actionType: actionTypeMap[opType] || '[Tag] Update Tag',
    opType,
    entityType: 'TAG',
    entityId: tagId,
    payload,
  });
};

/**
 * Factory for creating a generic operation with full control.
 * Use this for edge cases or entity types without dedicated factories.
 */
export const createGenericOperation = (
  client: TestClient,
  entityType: EntityType,
  entityId: string,
  opType: OpType,
  actionType: string,
  payload: unknown,
): Operation => {
  return client.createOperation({
    actionType,
    opType,
    entityType,
    entityId,
    payload,
  });
};

/**
 * Creates a minimal task payload for testing.
 * Based on the Task model structure.
 */
export const createMinimalTaskPayload = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  title: `Task ${id}`,
  created: Date.now(),
  timeSpent: 0,
  timeEstimate: 0,
  isDone: false,
  notes: '',
  tagIds: [],
  subTaskIds: [],
  attachments: [],
  ...overrides,
});

/**
 * Creates a minimal project payload for testing.
 */
export const createMinimalProjectPayload = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  title: `Project ${id}`,
  ...overrides,
});

/**
 * Creates a minimal tag payload for testing.
 */
export const createMinimalTagPayload = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  title: `Tag ${id}`,
  ...overrides,
});

/**
 * Factory for creating note operations.
 */
export const createNoteOperation = (
  client: TestClient,
  noteId: string,
  opType: OpType,
  payload: Record<string, unknown>,
): Operation => {
  const actionTypeMap: Record<OpType, string> = {
    [OpType.Create]: '[Note] Add Note',
    [OpType.Update]: '[Note] Update Note',
    [OpType.Delete]: '[Note] Delete Note',
    [OpType.Move]: '[Note] Move',
    [OpType.Batch]: '[Note] Batch Update',
    [OpType.SyncImport]: '[Note] Sync Import',
    [OpType.BackupImport]: '[Note] Backup Import',
    [OpType.Repair]: '[Note] Repair',
  };

  return client.createOperation({
    actionType: actionTypeMap[opType] || '[Note] Update Note',
    opType,
    entityType: 'NOTE',
    entityId: noteId,
    payload,
  });
};

/**
 * Factory for creating global config operations (singleton entity).
 */
export const createGlobalConfigOperation = (
  client: TestClient,
  opType: OpType,
  payload: Record<string, unknown>,
): Operation => {
  const actionTypeMap: Record<OpType, string> = {
    [OpType.Create]: '[Global Config] Update Global Config Section',
    [OpType.Update]: '[Global Config] Update Global Config Section',
    [OpType.Delete]: '[Global Config] Update Global Config Section',
    [OpType.Move]: '[Global Config] Update Global Config Section',
    [OpType.Batch]: '[Global Config] Update Global Config Section',
    [OpType.SyncImport]: '[Global Config] Sync Import',
    [OpType.BackupImport]: '[Global Config] Backup Import',
    [OpType.Repair]: '[Global Config] Repair',
  };

  return client.createOperation({
    actionType: actionTypeMap[opType] || '[Global Config] Update Global Config Section',
    opType,
    entityType: 'GLOBAL_CONFIG',
    entityId: '*', // Singleton uses '*' as entity ID
    payload,
  });
};

/**
 * Creates a minimal note payload for testing.
 */
export const createMinimalNotePayload = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  content: `Note ${id} content`,
  created: Date.now(),
  ...overrides,
});

/**
 * Creates a minimal global config payload section for testing.
 */
export const createMinimalGlobalConfigPayload = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  sectionKey: 'misc',
  sectionValue: {
    isDarkMode: false,
    isConfirmBeforeExit: true,
  },
  ...overrides,
});

/**
 * Factory for creating TaskRepeatCfg operations.
 */
export const createTaskRepeatCfgOperation = (
  client: TestClient,
  cfgId: string,
  opType: OpType,
  payload: Record<string, unknown>,
): Operation => {
  const actionTypeMap: Record<OpType, string> = {
    [OpType.Create]: '[TaskRepeatCfg] Add Task Repeat Cfg',
    [OpType.Update]: '[TaskRepeatCfg] Update Task Repeat Cfg',
    [OpType.Delete]: '[TaskRepeatCfg] Delete Task Repeat Cfg',
    [OpType.Move]: '[TaskRepeatCfg] Move',
    [OpType.Batch]: '[TaskRepeatCfg] Batch Update',
    [OpType.SyncImport]: '[TaskRepeatCfg] Sync Import',
    [OpType.BackupImport]: '[TaskRepeatCfg] Backup Import',
    [OpType.Repair]: '[TaskRepeatCfg] Repair',
  };

  return client.createOperation({
    actionType: actionTypeMap[opType] || '[TaskRepeatCfg] Update Task Repeat Cfg',
    opType,
    entityType: 'TASK_REPEAT_CFG',
    entityId: cfgId,
    payload,
  });
};

/**
 * Creates a minimal TaskRepeatCfg payload for testing.
 * Based on the TaskRepeatCfg model structure.
 */
export const createMinimalTaskRepeatCfgPayload = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  title: `Repeat ${id}`,
  repeatCycle: 'DAILY',
  repeatEvery: 1,
  startDate: '2024-01-01',
  lastTaskCreation: 0,
  lastTaskCreationDay: null,
  deletedInstanceDates: [],
  defaultEstimate: 0,
  order: 0,
  tagIds: [],
  projectId: null,
  ...overrides,
});

/**
 * Creates deterministic task ID for repeat instance.
 * Mirrors the logic in get-repeatable-task-id.util.ts
 */
export const getTestRepeatableTaskId = (cfgId: string, dueDay: string): string => {
  return `rpt_${cfgId}_${dueDay}`;
};
