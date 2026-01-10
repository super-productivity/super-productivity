import { truncate } from '../../util/truncate';
import { HANDLED_ERROR_PROP_STR } from '../../app.constants';
import { isObject } from '../../util/is-object';

const OBJECT_OBJECT_STR = '[object Object]';

// Helper to extract error string from various error shapes
export const getSyncErrorStr = (err: unknown): string => {
  // Handle string errors directly
  if (typeof err === 'string') {
    return truncate(err, 400);
  }

  // Handle null/undefined
  if (err == null) {
    return 'Unknown sync error';
  }

  const errAny = err as any;

  // Check for handled error marker first (highest priority)
  if (errAny[HANDLED_ERROR_PROP_STR]) {
    return truncate(String(errAny[HANDLED_ERROR_PROP_STR]), 400);
  }

  // Check message property (standard Error objects)
  if (typeof errAny.message === 'string' && errAny.message) {
    return truncate(errAny.message, 400);
  }

  // Check response.data (Axios-style errors)
  if (typeof errAny.response?.data === 'string' && errAny.response.data) {
    return truncate(errAny.response.data, 400);
  }

  // Check response.data.message (nested API error)
  if (typeof errAny.response?.data?.message === 'string') {
    return truncate(errAny.response.data.message, 400);
  }

  // Check for name property
  if (typeof errAny.name === 'string' && errAny.name) {
    return truncate(errAny.name, 400);
  }

  // Check for statusText (HTTP errors)
  if (typeof errAny.statusText === 'string' && errAny.statusText) {
    return truncate(errAny.statusText, 400);
  }

  // Try toString() but check for [object Object]
  if (typeof errAny.toString === 'function') {
    try {
      const str = errAny.toString();
      if (str && str !== OBJECT_OBJECT_STR) {
        return truncate(str, 400);
      }
    } catch {
      // toString() threw - fall through to JSON.stringify
    }
  }

  // Try JSON.stringify as last resort
  if (isObject(err)) {
    try {
      const jsonStr = JSON.stringify(err);
      if (jsonStr && jsonStr !== '{}') {
        return truncate(jsonStr, 400);
      }
    } catch {
      // Circular reference or other JSON error - fall through
    }
  }

  return 'Unknown sync error (unable to extract message)';
};
