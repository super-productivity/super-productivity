import { isEntityStateConsistent } from '../../util/check-fix-entity-state-consistency';
import {
  getLastValidityError,
  isRelatedModelDataValid,
} from './is-related-model-data-valid';
import {
  ArchiveModel,
  TimeTrackingState,
} from '../../features/time-tracking/time-tracking.model';
import { ProjectState } from '../../features/project/project.model';
import { MenuTreeState } from '../../features/menu-tree/store/menu-tree.model';
import { TaskState } from '../../features/tasks/task.model';
import { createValidate } from 'typia';
import { TagState } from '../../features/tag/tag.model';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';
import { Reminder } from '../../features/reminder/reminder.model';
import { PlannerState } from '../../features/planner/store/planner.reducer';
import { NoteState } from '../../features/note/note.model';
import { TaskRepeatCfgState } from '../../features/task-repeat-cfg/task-repeat-cfg.model';
import { BoardsState } from '../../features/boards/store/boards.reducer';
import { IssueProviderState } from '../../features/issue/issue.model';
import { MetricState } from '../../features/metric/metric.model';
import { GlobalConfigState } from '../../features/config/global-config.model';
import { AppDataComplete } from '../model/model-config';
import { ValidationResult } from '../core/types/sync.types';
import { OpLog } from '../../core/log';
import {
  PluginMetaDataState,
  PluginUserDataState,
} from '../../plugins/plugin-persistence.model'; // for more speed

// TODO check if we can improve on this
// for more speed
type DataToValidate = Omit<AppDataComplete, 'archiveOld' | 'archiveYoung'>;

// Create reusable validation functions
const _validateAllData = createValidate<DataToValidate>();
const _validateTask = createValidate<TaskState>();
const _validateTaskRepeatCfg = createValidate<TaskRepeatCfgState>();
const _validateArchive = createValidate<ArchiveModel>();
const _validateProject = createValidate<ProjectState>();
const _validateMenuTree = createValidate<MenuTreeState>();
const _validateTag = createValidate<TagState>();
const _validateSimpleCounter = createValidate<SimpleCounterState>();
const _validateNote = createValidate<NoteState>();
const _validateReminders = createValidate<Reminder[]>();
const _validatePlanner = createValidate<PlannerState>();
const _validateBoards = createValidate<BoardsState>();
const _validateIssueProvider = createValidate<IssueProviderState>();
const _validateMetric = createValidate<MetricState>();
const _validateGlobalConfig = createValidate<GlobalConfigState>();
const _validateTimeTracking = createValidate<TimeTrackingState>();
const _validatePluginUserData = createValidate<PluginUserDataState>();
const _validatePluginMetadata = createValidate<PluginMetaDataState>();

export const validateAllData = <R>(
  d: AppDataComplete | R,
): ValidationResult<AppDataComplete> => {
  const r = _wrapValidate(_validateAllData(d));
  return r as ValidationResult<AppDataComplete>;

  // unfortunately that is quite a bit slower
  // let r;
  // for (const key in appDataValidators) {
  //   const validator = appDataValidators[key];
  //   r = validator(d[key]);
  //   if (!r.success) {
  //     return r;
  //   }
  // }
  // return r;
};

/**
 * Maps each property of AppDataComplete to its corresponding validation function
 */
export const appDataValidators: {
  [K in keyof AppDataComplete]: <R>(
    data: AppDataComplete[K] | R,
  ) => ValidationResult<AppDataComplete[K] | R>;
} = {
  task: <R>(d: R | TaskState) => _wrapValidate(_validateTask(d), d, true),
  taskRepeatCfg: <R>(d: R | TaskRepeatCfgState) =>
    _wrapValidate(_validateTaskRepeatCfg(d), d, true),
  archiveYoung: <R>(d: R | ArchiveModel) => validateArchiveModel(d),
  archiveOld: <R>(d: R | ArchiveModel) => validateArchiveModel(d),
  project: <R>(d: R | ProjectState) => _wrapValidate(_validateProject(d), d, true),
  menuTree: <R>(d: R | MenuTreeState) => _wrapValidate(_validateMenuTree(d), d, false),
  tag: <R>(d: R | TagState) => _wrapValidate(_validateTag(d), d, true),
  simpleCounter: <R>(d: R | SimpleCounterState) =>
    _wrapValidate(_validateSimpleCounter(d), d, true),
  note: (d) => _wrapValidate(_validateNote(d), d, true),
  reminders: <R>(d: R | Reminder[]) => _wrapValidate(_validateReminders(d)),
  planner: <R>(d: R | PlannerState) => _wrapValidate(_validatePlanner(d)),
  boards: <R>(d: R | BoardsState) => _wrapValidate(_validateBoards(d)),
  issueProvider: (d) => _wrapValidate(_validateIssueProvider(d), d, true),
  metric: <R>(d: R | MetricState) => _wrapValidate(_validateMetric(d), d, true),
  globalConfig: <R>(d: R | GlobalConfigState) => _wrapValidate(_validateGlobalConfig(d)),
  timeTracking: <R>(d: R | TimeTrackingState) => _wrapValidate(_validateTimeTracking(d)),
  pluginUserData: <R>(d: R | PluginUserDataState) =>
    _wrapValidate(_validatePluginUserData(d)),
  pluginMetadata: <R>(d: R | PluginMetaDataState) =>
    _wrapValidate(_validatePluginMetadata(d)),
} as const;

const validateArchiveModel = <R>(d: ArchiveModel | R): ValidationResult<ArchiveModel> => {
  const r = _validateArchive(d);
  if (!r.success) {
    OpLog.log('Validation failed', (r as any)?.errors, r.data);
  }
  if (!isEntityStateConsistent((d as ArchiveModel).task)) {
    return {
      success: false,
      data: d,
      errors: [{ expected: 'Valid Entity State', path: '.', value: d }],
    };
  }
  return r;
};

export const validateAppDataProperty = <K extends keyof AppDataComplete>(
  key: K,
  data: AppDataComplete[K],
): ValidationResult<AppDataComplete[K]> => {
  return appDataValidators[key](data);
};

const _wrapValidate = <R>(
  result: ValidationResult<R>,
  d?: R,
  isEntityCheck = false,
): ValidationResult<R> => {
  if (!result.success) {
    OpLog.log('Validation failed', (result as any)?.errors, result, d);
  }
  if (isEntityCheck && !isEntityStateConsistent(d as any)) {
    return {
      success: false,
      data: d,
      errors: [{ expected: 'Valid Entity State', path: '.', value: d }],
    };
  }

  return result;
};

/**
 * Result of full validation (Typia schema + cross-model relationships).
 */
export interface FullValidationResult {
  isValid: boolean;
  typiaResult: ValidationResult<AppDataComplete>;
  crossModelError?: string;
}

/**
 * Performs complete validation: Typia schema validation followed by cross-model
 * relationship validation. This is the single source of truth for full data validation.
 *
 * Used by both SYNC_CONFIG.validate and ValidateStateService.
 */
export const validateFull = (data: AppDataComplete): FullValidationResult => {
  const typiaResult = validateAllData(data);

  if (!typiaResult.success) {
    return {
      isValid: false,
      typiaResult,
    };
  }

  // isRelatedModelDataValid can throw errors in dev mode via devError
  let isRelatedValid = false;
  let crossModelError: string | undefined;
  try {
    isRelatedValid = isRelatedModelDataValid(data);
  } catch (e) {
    isRelatedValid = false;
    crossModelError = e instanceof Error ? e.message : String(e);
  }

  if (!isRelatedValid) {
    return {
      isValid: false,
      typiaResult,
      crossModelError: crossModelError || getLastValidityError(),
    };
  }

  return {
    isValid: true,
    typiaResult,
  };
};
