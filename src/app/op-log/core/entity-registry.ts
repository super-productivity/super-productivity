/**
 * Central Entity Registry for Operation Log System
 *
 * Simple config objects - single source of truth for entity metadata.
 *
 * ## Adding a New Entity Type:
 * 1. Add the type to EntityType union in operation.types.ts
 * 2. Add config here
 * 3. Run `npm run checkFile src/app/op-log/core/entity-registry.ts`
 */

import { EntityAdapter } from '@ngrx/entity';
import { createSelector } from '@ngrx/store';
import { Dictionary } from '@ngrx/entity';
import { EntityType } from './operation.types';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS - Adapters & Feature Names
// ─────────────────────────────────────────────────────────────────────────────
import { TASK_FEATURE_NAME, taskAdapter } from '../../features/tasks/store/task.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME, tagAdapter } from '../../features/tag/store/tag.reducer';
import {
  adapter as noteAdapter,
  NOTE_FEATURE_NAME,
} from '../../features/note/store/note.reducer';
import {
  adapter as simpleCounterAdapter,
  SIMPLE_COUNTER_FEATURE_NAME,
} from '../../features/simple-counter/store/simple-counter.reducer';
import {
  adapter as taskRepeatCfgAdapter,
  TASK_REPEAT_CFG_FEATURE_NAME,
} from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  metricAdapter,
  METRIC_FEATURE_NAME,
} from '../../features/metric/store/metric.reducer';
import {
  adapter as issueProviderAdapter,
  ISSUE_PROVIDER_FEATURE_KEY,
} from '../../features/issue/store/issue-provider.reducer';
import { CONFIG_FEATURE_NAME } from '../../features/config/store/global-config.reducer';
import { TIME_TRACKING_FEATURE_KEY } from '../../features/time-tracking/store/time-tracking.reducer';
import { plannerFeatureKey } from '../../features/planner/store/planner.reducer';
import { BOARDS_FEATURE_NAME } from '../../features/boards/store/boards.reducer';
import { menuTreeFeatureKey } from '../../features/menu-tree/store/menu-tree.reducer';
import { REMINDER_FEATURE_NAME } from '../../features/reminder/store/reminder.reducer';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS - Selectors
// ─────────────────────────────────────────────────────────────────────────────
import {
  selectTaskEntities,
  selectTaskById,
} from '../../features/tasks/store/task.selectors';
import {
  selectProjectFeatureState,
  selectEntities as selectProjectEntitiesFromAdapter,
} from '../../features/project/store/project.reducer';
import { selectProjectById } from '../../features/project/store/project.selectors';
import {
  selectTagFeatureState,
  selectEntities as selectTagEntitiesFromAdapter,
  selectTagById,
} from '../../features/tag/store/tag.reducer';
import {
  selectNoteFeatureState,
  selectEntities as selectNoteEntitiesFromAdapter,
  selectNoteById,
} from '../../features/note/store/note.reducer';
import {
  selectSimpleCounterFeatureState,
  selectEntities as selectSimpleCounterEntitiesFromAdapter,
  selectSimpleCounterById,
} from '../../features/simple-counter/store/simple-counter.reducer';
import {
  selectTaskRepeatCfgFeatureState,
  selectTaskRepeatCfgById,
} from '../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  selectMetricFeatureState,
  selectEntities as selectMetricEntitiesFromAdapter,
  selectMetricById,
} from '../../features/metric/store/metric.selectors';
import {
  selectIssueProviderState,
  selectEntities as selectIssueProviderEntitiesFromAdapter,
  selectIssueProviderById,
} from '../../features/issue/store/issue-provider.selectors';
import { selectConfigFeatureState } from '../../features/config/store/global-config.reducer';
import { selectTimeTrackingState } from '../../features/time-tracking/store/time-tracking.selectors';
import { selectPlannerState } from '../../features/planner/store/planner.selectors';
import { selectBoardsState } from '../../features/boards/store/boards.selectors';
import { selectMenuTreeState } from '../../features/menu-tree/store/menu-tree.selectors';
import { selectReminderFeatureState } from '../../features/reminder/store/reminder.reducer';
import {
  selectContextFeatureState,
  WORK_CONTEXT_FEATURE_NAME,
} from '../../features/work-context/store/work-context.selectors';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage patterns for entity types in NgRx state.
 *
 * - `adapter`: Uses NgRx EntityAdapter for normalized entity collections.
 *              State shape: `{ ids: string[], entities: { [id]: Entity } }`
 *              Examples: TASK, PROJECT, TAG, NOTE, SIMPLE_COUNTER, METRIC, ISSUE_PROVIDER
 *
 * - `singleton`: Entire feature state is one object (no entity collection).
 *                State shape: The full feature state object
 *                Examples: GLOBAL_CONFIG, TIME_TRACKING, MENU_TREE, WORK_CONTEXT
 *
 * - `map`: State contains a map/dictionary keyed by some identifier.
 *          State shape: `{ [mapKey]: { [key]: value } }`
 *          Examples: PLANNER (days map keyed by date string)
 *
 * - `array`: State contains an array of items (not using EntityAdapter).
 *            State shape: Array or `{ [arrayKey]: Array }`
 *            Examples: BOARD (boardCfgs array), REMINDER (state IS the array)
 *
 * - `virtual`: Not stored in NgRx state. Used for operation types that don't
 *              correspond to actual state slices.
 *              Examples: PLUGIN_USER_DATA, PLUGIN_METADATA
 */
export type EntityStoragePattern = 'adapter' | 'singleton' | 'map' | 'array' | 'virtual';

/**
 * Base entity interface - all NgRx entities have an id.
 */
export interface BaseEntity {
  id: string;
}

/**
 * State selector function type compatible with store.select().
 */
export type StateSelector<T = unknown> = (state: object) => T;

/**
 * Factory function that creates a selector for a specific entity by ID.
 * Some entities (like ISSUE_PROVIDER) use this pattern.
 */
export type SelectByIdFactory = (id: string, key?: unknown) => StateSelector;

/**
 * Configuration for a single entity type in the operation log system.
 * Uses `unknown` for adapter/selector types to accommodate NgRx's complex
 * generic types while maintaining runtime safety via storagePattern checks.
 */
export interface EntityConfig {
  storagePattern: EntityStoragePattern;
  featureName?: string;
  payloadKey: string;
  /** NgRx EntityAdapter - cast to specific type at usage site */
  adapter?: EntityAdapter<BaseEntity>;
  /** Selector returning entity dictionary - works with store.select() */
  selectEntities?: StateSelector<Dictionary<BaseEntity>>;
  /** Selector or factory for single entity by ID */
  selectById?: StateSelector | SelectByIdFactory;
  /** Selector for full feature state (singleton/map/array patterns) */
  selectState?: StateSelector;
  /** Key within state for map storage pattern (e.g., 'days' for PLANNER) */
  mapKey?: string;
  /** Key within state for array storage pattern (null = state IS the array) */
  arrayKey?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY CONFIGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central registry of all entity configurations.
 *
 * Type assertion is used because NgRx's complex generic types (MemoizedSelector,
 * MemoizedSelectorWithProps, EntityAdapter) have variance that makes them
 * incompatible with a common interface without explicit casts at each usage.
 * Runtime safety is maintained via storagePattern checks at usage sites.
 */
export const ENTITY_CONFIGS = {
  // ── ADAPTER ENTITIES ───────────────────────────────────────────────────────
  TASK: {
    storagePattern: 'adapter',
    featureName: TASK_FEATURE_NAME,
    payloadKey: 'task',
    adapter: taskAdapter,
    selectEntities: selectTaskEntities,
    selectById: selectTaskById,
  },

  PROJECT: {
    storagePattern: 'adapter',
    featureName: PROJECT_FEATURE_NAME,
    payloadKey: 'project',
    adapter: projectAdapter,
    selectEntities: createSelector(
      selectProjectFeatureState,
      selectProjectEntitiesFromAdapter,
    ),
    selectById: selectProjectById,
  },

  TAG: {
    storagePattern: 'adapter',
    featureName: TAG_FEATURE_NAME,
    payloadKey: 'tag',
    adapter: tagAdapter,
    selectEntities: createSelector(selectTagFeatureState, selectTagEntitiesFromAdapter),
    selectById: selectTagById,
  },

  NOTE: {
    storagePattern: 'adapter',
    featureName: NOTE_FEATURE_NAME,
    payloadKey: 'note',
    adapter: noteAdapter,
    selectEntities: createSelector(selectNoteFeatureState, selectNoteEntitiesFromAdapter),
    selectById: selectNoteById,
  },

  SIMPLE_COUNTER: {
    storagePattern: 'adapter',
    featureName: SIMPLE_COUNTER_FEATURE_NAME,
    payloadKey: 'simpleCounter',
    adapter: simpleCounterAdapter,
    selectEntities: createSelector(
      selectSimpleCounterFeatureState,
      selectSimpleCounterEntitiesFromAdapter,
    ),
    selectById: selectSimpleCounterById,
  },

  TASK_REPEAT_CFG: {
    storagePattern: 'adapter',
    featureName: TASK_REPEAT_CFG_FEATURE_NAME,
    payloadKey: 'taskRepeatCfg',
    adapter: taskRepeatCfgAdapter,
    selectEntities: createSelector(
      selectTaskRepeatCfgFeatureState,
      (s: { entities: Dictionary<unknown> }) => s.entities,
    ),
    selectById: selectTaskRepeatCfgById,
  },

  METRIC: {
    storagePattern: 'adapter',
    featureName: METRIC_FEATURE_NAME,
    payloadKey: 'metric',
    adapter: metricAdapter,
    selectEntities: createSelector(
      selectMetricFeatureState,
      selectMetricEntitiesFromAdapter,
    ),
    selectById: selectMetricById,
  },

  ISSUE_PROVIDER: {
    storagePattern: 'adapter',
    featureName: ISSUE_PROVIDER_FEATURE_KEY,
    payloadKey: 'issueProvider',
    adapter: issueProviderAdapter,
    selectEntities: createSelector(
      selectIssueProviderState,
      selectIssueProviderEntitiesFromAdapter,
    ),
    selectById: selectIssueProviderById,
  },

  // ── SINGLETON ENTITIES ─────────────────────────────────────────────────────
  GLOBAL_CONFIG: {
    storagePattern: 'singleton',
    featureName: CONFIG_FEATURE_NAME,
    payloadKey: 'globalConfig',
    selectState: selectConfigFeatureState,
  },

  TIME_TRACKING: {
    storagePattern: 'singleton',
    featureName: TIME_TRACKING_FEATURE_KEY,
    payloadKey: 'timeTracking',
    selectState: selectTimeTrackingState,
  },

  MENU_TREE: {
    storagePattern: 'singleton',
    featureName: menuTreeFeatureKey,
    payloadKey: 'menuTree',
    selectState: selectMenuTreeState,
  },

  WORK_CONTEXT: {
    storagePattern: 'singleton',
    featureName: WORK_CONTEXT_FEATURE_NAME,
    payloadKey: 'workContext',
    selectState: selectContextFeatureState,
  },

  // ── MAP ENTITIES ───────────────────────────────────────────────────────────
  PLANNER: {
    storagePattern: 'map',
    featureName: plannerFeatureKey,
    payloadKey: 'planner',
    selectState: selectPlannerState,
    mapKey: 'days',
  },

  // ── ARRAY ENTITIES ─────────────────────────────────────────────────────────
  BOARD: {
    storagePattern: 'array',
    featureName: BOARDS_FEATURE_NAME,
    payloadKey: 'board',
    selectState: selectBoardsState,
    arrayKey: 'boardCfgs',
  },

  REMINDER: {
    storagePattern: 'array',
    featureName: REMINDER_FEATURE_NAME,
    payloadKey: 'reminder',
    selectState: selectReminderFeatureState,
    arrayKey: null, // State IS the array
  },

  // ── VIRTUAL ENTITIES ───────────────────────────────────────────────────────
  PLUGIN_USER_DATA: {
    storagePattern: 'virtual',
    payloadKey: 'pluginUserData',
  },

  PLUGIN_METADATA: {
    storagePattern: 'virtual',
    payloadKey: 'pluginMetadata',
  },

  // Note: ALL, RECOVERY, MIGRATION are not configured - they're special operation types
} as unknown as Partial<Record<EntityType, EntityConfig>>;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const getEntityConfig = (entityType: EntityType): EntityConfig | undefined =>
  ENTITY_CONFIGS[entityType];

export const getPayloadKey = (entityType: EntityType): string | undefined =>
  ENTITY_CONFIGS[entityType]?.payloadKey;

export const isAdapterEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'adapter';

export const isSingletonEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'singleton';

export const isMapEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'map';

export const isArrayEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'array';

export const isVirtualEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'virtual';

/**
 * Returns all payload keys from configured entities.
 * Useful for finding entities in payloads when the exact type is unknown.
 */
export const getAllPayloadKeys = (): string[] =>
  Object.values(ENTITY_CONFIGS)
    .map((config) => config?.payloadKey)
    .filter((key): key is string => !!key);
