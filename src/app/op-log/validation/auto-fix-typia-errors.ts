import { AppDataComplete } from '../model/model-config';
import { IValidation } from 'typia';
import type { SyncLogMeta } from '@sp/sync-core';
import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { RECREATE_FALLBACK } from '../core/recreate-fallback.const';
import { OP_LOG_SYNC_LOGGER } from '../core/sync-logger.adapter';

const LOG_PREFIX = '[auto-fix-typia-errors]';

const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const getValueLogMeta = (prefix: string, value: unknown): SyncLogMeta => ({
  [`${prefix}Type`]: getValueType(value),
  [`${prefix}StringLength`]: typeof value === 'string' ? value.length : undefined,
  [`${prefix}ArrayLength`]: Array.isArray(value) ? value.length : undefined,
  [`${prefix}KeyCount`]:
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length
      : undefined,
});

const getPathRoot = (keys: (string | number)[]): string | undefined =>
  typeof keys[0] === 'string' ? keys[0] : undefined;

const getRepairLogMeta = (
  path: string,
  keys: (string | number)[],
  fix: string,
): SyncLogMeta => ({
  path,
  pathDepth: keys.length,
  pathRoot: getPathRoot(keys),
  fix,
});

const logAutoFixAttempt = (
  error: IValidation.IError,
  path: string,
  keys: (string | number)[],
  value: unknown,
): void => {
  OP_LOG_SYNC_LOGGER.err(`${LOG_PREFIX} Attempting validation auto-fix`, undefined, {
    path,
    pathDepth: keys.length,
    pathRoot: getPathRoot(keys),
    expected: error.expected,
    ...getValueLogMeta('value', value),
  });
};

const logAutoFixApplied = (
  path: string,
  keys: (string | number)[],
  fix: string,
  value: unknown,
  replacement: unknown,
): void => {
  OP_LOG_SYNC_LOGGER.err(`${LOG_PREFIX} Applied validation auto-fix`, undefined, {
    ...getRepairLogMeta(path, keys, fix),
    ...getValueLogMeta('value', value),
    ...getValueLogMeta('replacement', replacement),
  });
};

const logAutoFixWarning = (
  path: string,
  keys: (string | number)[],
  fix: string,
  value: unknown,
  replacement: unknown,
): void => {
  OP_LOG_SYNC_LOGGER.warn(`${LOG_PREFIX} Applied validation auto-fix`, {
    ...getRepairLogMeta(path, keys, fix),
    ...getValueLogMeta('value', value),
    ...getValueLogMeta('replacement', replacement),
  });
};

export const autoFixTypiaErrors = (
  data: AppDataComplete,
  errors: IValidation.IError[],
): AppDataComplete => {
  if (!errors || errors.length === 0) {
    return data;
  }

  errors.forEach((error) => {
    if (error.path.startsWith('$input')) {
      const path = error.path.replace('$input.', '');
      const keys = parsePath(path);
      const value = getValueByPath(data, keys);
      logAutoFixAttempt(error, path, keys, value);

      if (
        error.expected.includes('number') &&
        typeof value === 'string' &&
        !isNaN(parseFloat(value))
      ) {
        const parsedValue = parseFloat(value);
        setValueByPath(data, keys, parsedValue);
        logAutoFixApplied(path, keys, 'string-to-number', value, parsedValue);
      } else if (keys[0] === 'globalConfig') {
        const defaultValue = getValueByPath(DEFAULT_GLOBAL_CONFIG, keys.slice(1));
        setValueByPath(data, keys, defaultValue);
        logAutoFixWarning(path, keys, 'global-config-default', value, defaultValue);
      } else if (error.expected.includes('undefined') && value === null) {
        setValueByPath(data, keys, undefined);
        logAutoFixApplied(path, keys, 'null-to-undefined', value, undefined);
      } else if (error.expected.includes('null') && value === 'null') {
        setValueByPath(data, keys, null);
        logAutoFixApplied(path, keys, 'string-null-to-null', value, null);
      } else if (error.expected.includes('undefined') && value === 'null') {
        setValueByPath(data, keys, undefined);
        logAutoFixApplied(path, keys, 'string-null-to-undefined', value, undefined);
      } else if (error.expected.includes('null') && value === undefined) {
        setValueByPath(data, keys, null);
        logAutoFixApplied(path, keys, 'undefined-to-null', value, null);
      } else if (error.expected.includes('boolean') && !value) {
        setValueByPath(data, keys, false);
        logAutoFixApplied(path, keys, 'falsey-to-false', value, false);
      } else if (keys[0] === 'task' && error.expected.includes('number')) {
        // If the value is a string that can be parsed to a number, parse it
        if (typeof value === 'string' && !isNaN(parseFloat(value))) {
          const parsedValue = parseFloat(value);
          setValueByPath(data, keys, parsedValue);
          logAutoFixApplied(path, keys, 'task-string-to-number', value, parsedValue);
        } else {
          setValueByPath(data, keys, 0);
          logAutoFixApplied(path, keys, 'task-number-default-zero', value, 0);
        }
      } else if (
        // Issue #7330: a TASK entity recreated from a partial LWW Update can
        // be missing required scalar fields. Primary fix is in the
        // meta-reducer; this branch is defense-in-depth for state already
        // corrupted on disk. Field list and default values both come from
        // RECREATE_FALLBACK so the two layers cannot drift.
        keys[0] === 'task' &&
        keys[1] === 'entities' &&
        keys.length === 4 &&
        value === undefined &&
        RECREATE_FALLBACK.TASK?.requiredKeys.includes(keys[3] as string)
      ) {
        const field = keys[3] as string;
        if (field === 'projectId') {
          // INBOX_PROJECT may be absent (corrupted import); mirror
          // normalizeRestoredTask at task-shared-lifecycle.reducer.ts:110.
          const projectEntities = ((
            data as { project?: { entities?: Record<string, unknown> } }
          ).project?.entities ?? {}) as Record<string, unknown>;
          const fallback = projectEntities[INBOX_PROJECT.id]
            ? INBOX_PROJECT.id
            : (Object.keys(projectEntities)[0] ?? INBOX_PROJECT.id);
          setValueByPath(data, keys, fallback);
          logAutoFixApplied(path, keys, 'task-project-id-fallback', value, fallback);
        } else {
          const defaultValue = RECREATE_FALLBACK.TASK.defaults[field];
          setValueByPath(data, keys, defaultValue);
          logAutoFixApplied(
            path,
            keys,
            'task-required-field-default',
            value,
            defaultValue,
          );
        }
      } else if (
        keys[0] === 'simpleCounter' &&
        keys[1] === 'entities' &&
        keys.length >= 5 &&
        keys[3] === 'countOnDay' &&
        error.expected.includes('number') &&
        value === null
      ) {
        // Fix for issue #4593: simpleCounter countOnDay null value
        setValueByPath(data, keys, 0);
        logAutoFixApplied(path, keys, 'simple-counter-countOnDay-null-to-zero', value, 0);
      } else if (
        keys[0] === 'taskRepeatCfg' &&
        keys[1] === 'entities' &&
        keys.length >= 4 &&
        keys[3] === 'order' &&
        error.expected.includes('number') &&
        value === null
      ) {
        // Fix for issue #4897: taskRepeatCfg order null value
        // Set order based on position in ids array or default to 0
        const entityId = keys[2] as string;
        const ids = (data.taskRepeatCfg?.ids as string[]) || [];
        const orderIndex = ids.indexOf(entityId);
        const orderValue = orderIndex >= 0 ? orderIndex : 0;
        setValueByPath(data, keys, orderValue);
        logAutoFixApplied(
          path,
          keys,
          'task-repeat-cfg-order-null-to-index',
          value,
          orderValue,
        );
      } else if (
        keys[0] === 'metric' &&
        keys[1] === 'entities' &&
        keys.length === 4 &&
        ['obstructions', 'improvements', 'improvementsTomorrow'].includes(
          keys[3] as string,
        ) &&
        error.expected.includes('Array<string>')
      ) {
        // Fix deprecated metric array fields (obstructions, improvements, improvementsTomorrow)
        // These fields are marked "TODO remove" and will be removed in future
        setValueByPath(data, keys, []);
        logAutoFixApplied(path, keys, 'metric-deprecated-array-default', value, []);
      } else if (
        keys[0] === 'improvement' &&
        keys[1] === 'hiddenImprovementBannerItems' &&
        error.expected.includes('Array<string>')
      ) {
        // Fix improvement.hiddenImprovementBannerItems (deprecated)
        setValueByPath(data, keys, []);
        logAutoFixApplied(path, keys, 'improvement-deprecated-array-default', value, []);
      }
    }
  });
  return data;
};

/**
 * Parse a path string into an array of keys, handling both dot notation and bracket notation.
 * Example: 'task.entities["BbgHI8-2NZ7zBn7BNVQPG"].timeEstimate' becomes
 * ['task', 'entities', 'BbgHI8-2NZ7zBn7BNVQPG', 'timeEstimate']
 */
const parsePath = (path: string): (string | number)[] => {
  const keys: (string | number)[] = [];
  const pathParts = path.split('.');

  for (const part of pathParts) {
    if (part.includes('[')) {
      const partsInner = part
        .replace(/\]/g, '')
        .replace(/\"/g, '')
        .replace(/'/g, '')
        .split('[');
      partsInner.forEach((innerPart) => {
        if (innerPart) keys.push(innerPart);
      });
    } else {
      keys.push(part);
    }
  }
  return keys;
};

/**
 * Gets a value by dynamic path. Returns unknown since path is runtime-determined.
 * Callers must use type guards or assertions based on validation context.
 */
const getValueByPath = (obj: unknown, path: (string | number)[]): unknown =>
  path.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string | number, unknown>)[key];
  }, obj);

/**
 * Sets a value by dynamic path. This is inherently untyped since paths
 * come from Typia validation errors at runtime.
 */
const setValueByPath = (
  obj: Record<string, unknown>,
  path: (string | number)[],
  value: unknown,
): void => {
  if (!Array.isArray(path) || path.length === 0) return;

  let current: Record<string | number, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = current[key];
    if (next === null || next === undefined || typeof next !== 'object') {
      current[key] = typeof path[i + 1] === 'number' ? [] : {};
    }
    current = current[key] as Record<string | number, unknown>;
  }

  current[path[path.length - 1]] = value;
};
