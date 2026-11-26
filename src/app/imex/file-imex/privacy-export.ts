import { dirtyDeepCopy } from '../../util/dirtyDeepCopy';
import {
  readTaskHistoryDelivery,
  TASK_HISTORY_DELIVERY_PREFIX,
} from '../../features/tasks/task-history/task-history-delivery';

let i: number = 0;

const KEY_TO_REPLACE = [
  'username',
  'userName',
  'loginName',
  'password',
  'token',
  'apiKey',
  'secret',
  'authorization',
  'notes',
  'authCode',
  'accessToken',
  'host',
  'gitlabBaseUrl',
  'nextcloudBaseUrl',
  'icalUrl',
  'organization',
  'syncFilePath',
  'syncFolderPath',
  'title',
  'originalImgPath',
  'path',
  'content',

  'repo',
  'repoFullname',
  'filterUserName',
  'filterUsername',
  'caldavUrl',
  'api_key',

  // Issue #6020: Additional PII fields
  'resourceName',
  'name',
  'description',
  'location',
  'calProviderId',
  'summary',

  // Calendar regex filter patterns may contain user-specific title fragments
  'filterIncludeRegex',
  'filterExcludeRegex',

  // Agent capture private key (sync.captureKey)
  'privateKeyPkcs8',
];

const maskString = (key: string, val: string, counter: number): string => {
  if (KEY_TO_REPLACE.includes(key) && val.length > 0) {
    return `${key}__${counter}`;
  } else {
    return val;
  }
};

const recurse = (obj: unknown): void => {
  if (typeof obj !== 'object' || obj === null) return;

  const record = obj as Record<string, unknown>;
  if (record['field'] === 'title' || record['field'] === 'notes') {
    for (const side of ['before', 'after']) {
      const entry = record[side] as { kind?: unknown; value?: unknown } | undefined;
      // Copies of the same event must stay identical in the anonymized export.
      if (entry?.kind === 'text' && typeof entry.value === 'string' && entry.value) {
        entry.value = '[redacted]';
      }
    }
  }
  if (
    typeof record['id'] === 'string' &&
    record['id'].startsWith(TASK_HISTORY_DELIVERY_PREFIX) &&
    Object.hasOwn(record, 'data')
  ) {
    try {
      const envelope = readTaskHistoryDelivery(record);
      recurse(envelope);
      record['data'] = envelope ? JSON.stringify(envelope) : '';
    } catch {
      // Never include the original opaque payload if it cannot be anonymized.
      record['data'] = '';
    }
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = (obj as Record<string, unknown>)[key];
      if (Array.isArray(val)) {
        val.forEach((arrVal) => {
          if (typeof arrVal === 'object' && arrVal !== null) {
            recurse(arrVal);
          }
        });
      } else if (typeof val === 'object' && val !== null) {
        recurse(val);
      } else if (typeof val === 'string') {
        (obj as Record<string, unknown>)[key] = maskString(key, val, i);
      }
    }
    i++;
  }
};

export const privacyExport = (d: unknown): string => {
  const cpy = dirtyDeepCopy(d);
  recurse(cpy);
  return JSON.stringify(cpy);
};
