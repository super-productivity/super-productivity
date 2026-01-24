import { OperationLike, SchemaMigration } from '../migration.types';

/**
 * Mapping from old misc field names to new tasks field names.
 * Key: old field name in misc
 * Value: new field name in tasks (or transform function)
 */
const FIELD_MAPPINGS: Record<string, string | ((value: unknown) => [string, unknown])> = {
  isConfirmBeforeTaskDelete: 'isConfirmBeforeDelete',
  isAutoAddWorkedOnToToday: 'isAutoAddWorkedOnToToday',
  isAutMarkParentAsDone: 'isAutoMarkParentAsDone', // Fixed typo
  isTrayShowCurrentTask: 'isTrayShowCurrent',
  isTurnOffMarkdown: (value) => ['isMarkdownFormattingInNotesEnabled', !value], // Inverted
  defaultProjectId: 'defaultProjectId',
  taskNotesTpl: 'notesTemplate',
};

const MIGRATED_FIELDS = Object.keys(FIELD_MAPPINGS);

export const MiscToTasksSettingsMigration_v1v2: SchemaMigration = {
  fromVersion: 1,
  toVersion: 2,
  description: 'Move settings from MiscConfig to TasksConfig.',

  migrateState: (state: any) => {
    const misc = state.globalConfig?.misc;
    if (!misc || !hasMigratedFields(misc)) {
      return state;
    }

    const tasks = state.globalConfig?.tasks ?? {};

    // Skip if already migrated (tasks has new fields AND misc has no migrated fields)
    if (tasks.isConfirmBeforeDelete !== undefined && !hasMigratedFields(misc)) {
      return state;
    }

    return {
      ...state,
      globalConfig: {
        ...state.globalConfig,
        misc: removeMigratedFields(misc),
        tasks: { ...tasks, ...transformMiscToTasks(misc) },
      },
    };
  },

  requiresOperationMigration: true,
  migrateOperation: (op: OperationLike): OperationLike | OperationLike[] | null => {
    if (op.entityType !== 'GLOBAL_CONFIG' || op.entityId !== 'misc') {
      return op;
    }

    const payload = op.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') {
      return op;
    }

    // Extract sectionCfg from various payload formats
    let sectionCfg: Record<string, unknown> | null = null;
    let actionPayload: Record<string, unknown> | null = null;

    if (isMultiEntityPayload(payload)) {
      actionPayload = payload.actionPayload;
      sectionCfg = extractSectionCfg(actionPayload);
    } else if ('sectionCfg' in payload) {
      actionPayload = payload;
      sectionCfg = extractSectionCfg(payload);
    } else {
      sectionCfg = payload;
    }

    if (!sectionCfg || !hasMigratedFields(sectionCfg)) {
      return op;
    }

    // Transform settings
    const tasksCfg = transformMiscToTasks(sectionCfg);
    const miscCfg = removeMigratedFields(sectionCfg);

    // Build payload for the new operation
    const buildPayload = (cfg: Record<string, unknown>, sectionKey: string): unknown => {
      if (isMultiEntityPayload(payload)) {
        return {
          ...payload,
          actionPayload: { ...actionPayload, sectionKey, sectionCfg: cfg },
        };
      } else if (actionPayload && 'sectionCfg' in actionPayload) {
        return { ...actionPayload, sectionKey, sectionCfg: cfg };
      }
      return cfg;
    };

    const result: OperationLike[] = [];

    if (Object.keys(miscCfg).length > 0) {
      result.push({
        ...op,
        id: `${op.id}_misc`,
        payload: buildPayload(miscCfg, 'misc'),
      });
    }

    if (Object.keys(tasksCfg).length > 0) {
      result.push({
        ...op,
        id: `${op.id}_tasks`,
        entityId: 'tasks',
        payload: buildPayload(tasksCfg, 'tasks'),
      });
    }

    return result.length === 0 ? null : result.length === 1 ? result[0] : result;
  },
};

function transformMiscToTasks(miscCfg: Record<string, unknown>): Record<string, unknown> {
  const tasksCfg: Record<string, unknown> = {};

  for (const [oldKey, mapping] of Object.entries(FIELD_MAPPINGS)) {
    if (oldKey in miscCfg) {
      if (typeof mapping === 'function') {
        const [newKey, newValue] = mapping(miscCfg[oldKey]);
        tasksCfg[newKey] = newValue;
      } else {
        tasksCfg[mapping] = miscCfg[oldKey];
      }
    }
  }

  return tasksCfg;
}

function removeMigratedFields(miscCfg: Record<string, unknown>): Record<string, unknown> {
  const result = { ...miscCfg };
  for (const key of MIGRATED_FIELDS) {
    delete result[key];
  }
  return result;
}

function hasMigratedFields(cfg: Record<string, unknown>): boolean {
  return MIGRATED_FIELDS.some((key) => key in cfg);
}

interface MultiEntityPayload {
  actionPayload: Record<string, unknown>;
  entityChanges?: unknown[];
}

function isMultiEntityPayload(payload: unknown): payload is MultiEntityPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'actionPayload' in payload &&
    typeof (payload as MultiEntityPayload).actionPayload === 'object'
  );
}

function extractSectionCfg(
  actionPayload: Record<string, unknown>,
): Record<string, unknown> | null {
  if ('sectionCfg' in actionPayload && typeof actionPayload['sectionCfg'] === 'object') {
    return actionPayload['sectionCfg'] as Record<string, unknown>;
  }
  return null;
}
