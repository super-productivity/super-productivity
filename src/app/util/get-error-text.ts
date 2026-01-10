import { isObject } from './is-object';
import { HANDLED_ERROR_PROP_STR } from '../app.constants';

const OBJECT_OBJECT_STR = '[object Object]';

export const getErrorTxt = (err: unknown): string => {
  // Handle string errors directly
  if (typeof err === 'string') {
    return err;
  }

  // Handle null/undefined
  if (err == null) {
    return 'Unknown error (null/undefined)';
  }

  const errAny = err as any;

  // Check for handled error marker first
  if (errAny[HANDLED_ERROR_PROP_STR]) {
    return errAny[HANDLED_ERROR_PROP_STR];
  }

  // Check direct message property (standard Error objects)
  if (typeof errAny.message === 'string' && errAny.message) {
    return errAny.message;
  }

  // Check nested error.message (HttpErrorResponse pattern)
  if (isObject(errAny.error)) {
    if (typeof errAny.error.message === 'string' && errAny.error.message) {
      return errAny.error.message;
    }
    if (typeof errAny.error.name === 'string' && errAny.error.name) {
      return errAny.error.name;
    }
    // Handle deeper nesting (ngx-translate pattern)
    if (isObject(errAny.error.error)) {
      if (typeof errAny.error.error.message === 'string') {
        return errAny.error.error.message;
      }
    }
  }

  // Check for name property (some Error subclasses)
  if (typeof errAny.name === 'string' && errAny.name) {
    return errAny.name;
  }

  // Check for statusText (HTTP errors)
  if (typeof errAny.statusText === 'string' && errAny.statusText) {
    return errAny.statusText;
  }

  // Try toString() but check for [object Object]
  if (typeof errAny.toString === 'function') {
    try {
      const str = errAny.toString();
      if (str && str !== OBJECT_OBJECT_STR) {
        return str;
      }
    } catch {
      // toString() threw - fall through to JSON.stringify
    }
  }

  // Try JSON.stringify as last resort for objects
  if (isObject(err)) {
    try {
      const jsonStr = JSON.stringify(err);
      if (jsonStr && jsonStr !== '{}') {
        return jsonStr.length > 200 ? jsonStr.substring(0, 200) + '...' : jsonStr;
      }
    } catch {
      // Circular reference or other JSON error - fall through
    }
  }

  return 'Unknown error (unable to extract message)';
};
