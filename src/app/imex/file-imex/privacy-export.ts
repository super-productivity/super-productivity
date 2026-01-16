import { dirtyDeepCopy } from '../../util/dirtyDeepCopy';

let i: number = 0;

const KEY_TO_REPLACE = [
  'username',
  'userName',
  'password',
  'token',
  'notes',
  'authCode',
  'accessToken',
  'host',
  'gitlabBaseUrl',
  'syncFilePath',
  'syncFolderPath',
  'title',
  'originalImgPath',
  'path',
  'content',

  'repo',
  'repoFullname',
  'filterUserName',
  'caldavUrl',
  'api_key',

  // Issue #6020: Additional PII fields
  'resourceName',
  'name',
  'description',
  'location',
  'calProviderId',
  'summary',
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
