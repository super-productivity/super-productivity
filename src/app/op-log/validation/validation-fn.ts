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
import { SectionState } from '../../features/section/section.model';
import { MenuTreeState } from '../../features/menu-tree/store/menu-tree.model';
import { TaskState } from '../../features/tasks/task.model';
import { createValidate, IValidation } from 'typia';
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
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';
import { getValidationFailureLogMeta } from './validation-log-meta';
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
const _validateSection = createValidate<SectionState>();

/**
 * `Task.issueType` and `IssueProvider.issueProviderKey` are validated against the
 * `IssueProviderKey` union, a set typia compiles into a *closed* membership check at
 * build time. That set is open-ended by design: new built-in providers (e.g. the
 * Plainspace integration, #8424) and plugin providers (`plugin:${string}`) keep being
 * added. When a newer client syncs a task/provider using a key an older client's build
 * does not know yet, typia would otherwise report the unknown — but well-formed —
 * value as data corruption. That surfaces a "repair your data?" dialog; declining it
 * wedges sync (state never marked IN_SYNC) and accepting it risks mangling valid data.
 * An unknown *string* provider key is a forward-compatible value, not damage, so we
 * drop those specific errors and carry the value through untouched.
 *
 * typia reports the two fields with different error shapes (both verified against the
 * real validator in the spec), so we match both:
 *  1. `Task.issueType` is a plain optional union field → the error is AT the field,
 *     `value` is the unknown string, `expected` is the union (identified by its
 *     `plugin:${string}` branch).
 *  2. `IssueProvider` is a *discriminated union* keyed on `issueProviderKey` → an
 *     unknown discriminant produces a parent-OBJECT error (`value` is the whole
 *     entity, `expected` lists the member type names, NOT a `.issueProviderKey`
 *     path). We tolerate it when that object carries a non-empty string
 *     `issueProviderKey` and `expected` names the union via its
 *     `IssueProviderPluginType` member.
 *
 * Either way a non-string key (null/number/object) stays a corruption error, and a
 * known-but-malformed entity fails on its own child-field errors (not these), so
 * genuine damage is never masked.
 *
 * shortcut: matched by typia error shape — if more open-ended enums appear, prefer
 * typing them as opaque strings in the synced model over extending this matcher.
 */
const _ISSUE_TYPE_PATH_RE = /\.issueType$/;

const _hasUnknownStringProviderKey = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { issueProviderKey?: unknown }).issueProviderKey === 'string' &&
  (value as { issueProviderKey: string }).issueProviderKey.length > 0;

export const isForwardCompatibleProviderKeyError = (err: IValidation.IError): boolean => {
  // (1) Task.issueType — scalar union field, error reported at the field itself.
  if (
    typeof err.value === 'string' &&
    err.value.length > 0 &&
    _ISSUE_TYPE_PATH_RE.test(err.path) &&
    err.expected.includes('plugin:')
  ) {
    return true;
  }
  // (2) IssueProvider — discriminated union, unknown discriminant reported as a
  //     parent-object error. Only the IssueProvider union names IssueProviderPluginType.
  return (
    err.expected.includes('IssueProviderPluginType') &&
    _hasUnknownStringProviderKey(err.value)
  );
};

/**
 * Strips forward-compatible provider-key errors from a typia result, recomputing
 * `success` if those were the only failures. See {@link isForwardCompatibleProviderKeyError}.
 */
const _relaxForwardCompatibleErrors = <R>(
  result: ValidationResult<R>,
): ValidationResult<R> => {
  if (result.success) {
    return result;
  }
  const remaining = result.errors.filter(
    (err) => !isForwardCompatibleProviderKeyError(err),
  );
  if (remaining.length === result.errors.length) {
    return result;
  }
  if (remaining.length === 0) {
    return { success: true, data: result.data as R };
  }
  return { ...result, errors: remaining };
};

export const validateAllData = <R>(
  d: AppDataComplete | R,
): ValidationResult<AppDataComplete> => {
  const r = _wrapValidate(_validateAllData(d), d, false, 'appData');
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
  task: <R>(d: R | TaskState) => _wrapValidate(_validateTask(d), d, true, 'task'),
  taskRepeatCfg: <R>(d: R | TaskRepeatCfgState) =>
    _wrapValidate(_validateTaskRepeatCfg(d), d, true, 'taskRepeatCfg'),
  archiveYoung: <R>(d: R | ArchiveModel) => validateArchiveModel(d, 'archiveYoung'),
  archiveOld: <R>(d: R | ArchiveModel) => validateArchiveModel(d, 'archiveOld'),
  project: <R>(d: R | ProjectState) =>
    _wrapValidate(_validateProject(d), d, true, 'project'),
  menuTree: <R>(d: R | MenuTreeState) =>
    _wrapValidate(_validateMenuTree(d), d, false, 'menuTree'),
  tag: <R>(d: R | TagState) => _wrapValidate(_validateTag(d), d, true, 'tag'),
  simpleCounter: <R>(d: R | SimpleCounterState) =>
    _wrapValidate(_validateSimpleCounter(d), d, true, 'simpleCounter'),
  note: (d) => _wrapValidate(_validateNote(d), d, true, 'note'),
  reminders: <R>(d: R | Reminder[]) =>
    _wrapValidate(_validateReminders(d), d, false, 'reminders'),
  planner: <R>(d: R | PlannerState) =>
    _wrapValidate(_validatePlanner(d), d, false, 'planner'),
  boards: <R>(d: R | BoardsState) =>
    _wrapValidate(_validateBoards(d), d, false, 'boards'),
  issueProvider: (d) =>
    _wrapValidate(_validateIssueProvider(d), d, true, 'issueProvider'),
  metric: <R>(d: R | MetricState) => _wrapValidate(_validateMetric(d), d, true, 'metric'),
  globalConfig: <R>(d: R | GlobalConfigState) =>
    _wrapValidate(_validateGlobalConfig(d), d, false, 'globalConfig'),
  timeTracking: <R>(d: R | TimeTrackingState) =>
    _wrapValidate(_validateTimeTracking(d), d, false, 'timeTracking'),
  pluginUserData: <R>(d: R | PluginUserDataState) =>
    _wrapValidate(_validatePluginUserData(d), d, false, 'pluginUserData'),
  pluginMetadata: <R>(d: R | PluginMetaDataState) =>
    _wrapValidate(_validatePluginMetadata(d), d, false, 'pluginMetadata'),
  section: <R>(d: R | SectionState) =>
    _wrapValidate(_validateSection(d), d, true, 'section'),
} as const;

const logValidationFailure = <R>(
  context: string,
  result: ValidationResult<R>,
  inputData?: unknown,
  isEntityCheck = false,
): void => {
  OP_LOG_SYNC_LOGGER.log(
    '[validation-fn] Validation failed',
    getValidationFailureLogMeta({ context, result, inputData, isEntityCheck }),
  );
};

const validateArchiveModel = <R>(
  d: ArchiveModel | R,
  context: 'archiveYoung' | 'archiveOld',
): ValidationResult<ArchiveModel> => {
  const r = _relaxForwardCompatibleErrors(_validateArchive(d));
  if (!r.success) {
    logValidationFailure(context, r, d);
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
  rawResult: ValidationResult<R>,
  d?: unknown,
  isEntityCheck = false,
  context = 'unknown',
): ValidationResult<R> => {
  const result = _relaxForwardCompatibleErrors(rawResult);
  if (!result.success) {
    logValidationFailure(context, result, d, isEntityCheck);
  }
  if (isEntityCheck && !isEntityStateConsistent(d as any)) {
    return {
      success: false,
      data: d as R,
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
 * Used by ValidateStateService, BackupService, and OperationLogMigrationService (via dynamic import).
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
