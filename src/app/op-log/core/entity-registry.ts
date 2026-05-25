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

import { InjectionToken } from '@angular/core';
import { createSelector } from '@ngrx/store';
import {
  getAllPayloadKeys as getAllPayloadKeysFromRegistry,
  getEntityConfig as getEntityConfigFromRegistry,
  getPayloadKey as getPayloadKeyFromRegistry,
  isAdapterEntity as isAdapterEntityFromCore,
  isArrayEntity as isArrayEntityFromCore,
  isMapEntity as isMapEntityFromCore,
  isSingletonEntity as isSingletonEntityFromCore,
  isVirtualEntity as isVirtualEntityFromCore,
} from '@sp/sync-core';
import type { EntityConfig, EntityRegistry } from '@sp/sync-core';
import { EntityType } from './operation.types';

export type {
  BaseEntity,
  EntityAdapterLike,
  EntityConfig,
  EntityDictionary,
  EntityRegistry,
  EntityStoragePattern,
  EntityUpdateLike,
  PropsStateSelector,
  SelectById,
  SelectByIdFactory,
  StateSelector,
} from '@sp/sync-core';

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
import {
  SECTION_FEATURE_NAME,
  adapter as sectionAdapter,
  selectEntities as selectSectionEntitiesFromAdapter,
} from '../../features/section/store/section.reducer';

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
import {
  selectSectionFeatureState,
  selectSectionById,
} from '../../features/section/store/section.selectors';

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
export const buildEntityRegistry = (): EntityRegistry<EntityType> =>
  ({
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
      selectEntities: createSelector(
        selectNoteFeatureState,
        selectNoteEntitiesFromAdapter,
      ),
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
        (s: { entities: Record<string, unknown> }) => s.entities,
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

    SECTION: {
      storagePattern: 'adapter',
      featureName: SECTION_FEATURE_NAME,
      payloadKey: 'section',
      adapter: sectionAdapter,
      selectEntities: createSelector(
        selectSectionFeatureState,
        selectSectionEntitiesFromAdapter,
      ),
      selectById: selectSectionById,
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
  }) satisfies EntityRegistry<EntityType>;

export const ENTITY_CONFIGS = buildEntityRegistry();

export const ENTITY_REGISTRY = new InjectionToken<EntityRegistry<EntityType>>(
  'ENTITY_REGISTRY',
  {
    providedIn: 'root',
    factory: () => ENTITY_CONFIGS,
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const getEntityConfig = (entityType: EntityType): EntityConfig | undefined =>
  getEntityConfigFromRegistry(ENTITY_CONFIGS, entityType);

export const getPayloadKey = (entityType: EntityType): string | undefined =>
  getPayloadKeyFromRegistry(ENTITY_CONFIGS, entityType);

/**
 * Sentinel `entityId` value used for singleton entities (`globalConfig`,
 * `metric`, etc.). These have no per-entity primary key, so the op-log
 * uses `'*'` to denote "the one and only" instance.
 *
 * Used wherever singleton ops need to be distinguished from adapter ops,
 * e.g. when conditionally injecting `id` into LWW payloads.
 */
export const SINGLETON_ENTITY_ID = '*' as const;

export const isSingletonEntityId = (entityId: string | null | undefined): boolean =>
  entityId === SINGLETON_ENTITY_ID;

export const isAdapterEntity = isAdapterEntityFromCore;

export const isSingletonEntity = isSingletonEntityFromCore;

export const isMapEntity = isMapEntityFromCore;

export const isArrayEntity = isArrayEntityFromCore;

export const isVirtualEntity = isVirtualEntityFromCore;

/**
 * Returns all payload keys from configured entities.
 * Useful for finding entities in payloads when the exact type is unknown.
 */
export const getAllPayloadKeys = (): string[] =>
  getAllPayloadKeysFromRegistry(ENTITY_CONFIGS);
