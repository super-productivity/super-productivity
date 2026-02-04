import { AppStateSnapshot } from '../core/types/backup.types';

/**
 * Extracts all entity keys from the state snapshot.
 * Used for conflict detection to distinguish between entities that existed
 * at snapshot time vs new entities created later on other clients.
 *
 * Format: "ENTITY_TYPE:entityId" (e.g., "TASK:abc123", "PROJECT:xyz789")
 */
export const extractEntityKeysFromState = (state: AppStateSnapshot): string[] => {
  const keys: string[] = [];

  // Entity adapter states (have ids array)
  // Cast to expected type - we know NgRx entity adapter states have ids array
  type EntityState = { ids?: (string | number)[] } | undefined;
  const entityStates: Array<{
    key: string;
    state: EntityState;
  }> = [
    { key: 'TASK', state: state.task as EntityState },
    { key: 'PROJECT', state: state.project as EntityState },
    { key: 'TAG', state: state.tag as EntityState },
    { key: 'NOTE', state: state.note as EntityState },
    { key: 'ISSUE_PROVIDER', state: state.issueProvider as EntityState },
    { key: 'SIMPLE_COUNTER', state: state.simpleCounter as EntityState },
    { key: 'TASK_REPEAT_CFG', state: state.taskRepeatCfg as EntityState },
    { key: 'METRIC', state: state.metric as EntityState },
  ];

  for (const { key, state: entityState } of entityStates) {
    if (entityState?.ids) {
      for (const id of entityState.ids) {
        keys.push(`${key}:${id}`);
      }
    }
  }

  // Reminders are an array, not an entity adapter state
  if (Array.isArray(state.reminders)) {
    for (const reminder of state.reminders) {
      if (reminder?.id) {
        keys.push(`REMINDER:${reminder.id}`);
      }
    }
  }

  // Plugin User Data (Array)
  if (Array.isArray(state.pluginUserData)) {
    for (const item of state.pluginUserData) {
      if (item?.id) {
        keys.push(`PLUGIN_USER_DATA:${item.id}`);
      }
    }
  }

  // Plugin Metadata (Array)
  if (Array.isArray(state.pluginMetadata)) {
    for (const item of state.pluginMetadata) {
      if (item?.id) {
        keys.push(`PLUGIN_METADATA:${item.id}`);
      }
    }
  }

  // Boards have a different structure: { boardCfgs: BoardCfg[] }
  type BoardsState = { boardCfgs?: Array<{ id?: string }> } | undefined;
  const boardsState = state.boards as BoardsState;
  if (boardsState?.boardCfgs && Array.isArray(boardsState.boardCfgs)) {
    for (const board of boardsState.boardCfgs) {
      if (board?.id) {
        keys.push(`BOARD:${board.id}`);
      }
    }
  }

  // Singleton states (single entity with fixed ID)
  // These always exist and are identified by their type
  if (state.globalConfig) {
    keys.push('GLOBAL_CONFIG:GLOBAL_CONFIG');
  }
  if (state.planner) {
    keys.push('PLANNER:PLANNER');
  }
  if (state.menuTree) {
    keys.push('MENU_TREE:MENU_TREE');
  }
  if (state.timeTracking) {
    keys.push('TIME_TRACKING:TIME_TRACKING');
  }

  // Archive entities (nested task states)
  // These share the TASK entity type since archived tasks are still tasks
  if (state.archiveYoung?.task?.ids) {
    for (const id of state.archiveYoung.task.ids) {
      keys.push(`TASK:${id}`);
    }
  }
  if (state.archiveOld?.task?.ids) {
    for (const id of state.archiveOld.task.ids) {
      keys.push(`TASK:${id}`);
    }
  }

  return keys;
};
