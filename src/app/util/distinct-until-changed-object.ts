import { isObject } from './is-object';

export const distinctUntilChangedObject = <T>(a: T, b: T): boolean => {
  // Arrays satisfy isObject (`[] === Object([])`), so they are covered here too.
  if (isObject(a) && isObject(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  } else {
    return a === b;
  }
};
